import './isolate.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, patchState } from '../lib/state.mjs';
import { desktopExitOnClose, saveSettings, settingsOf, settingsWithSecret } from '../lib/settings.mjs';
import { MANIFEST, applyArchive, backup, download, pruneSnapshots, remoteUrl, restore, testConnection } from '../lib/webdav.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'ap-settings-'));
test.after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
const freshHome = name => {
	const home = join(sandbox, name);
	mkdirSync(join(home, 'personas'), { recursive: true });
	writeFileSync(join(home, 'personas', 'alpha.md'), '---\nid: alpha\nname: Alpha\n---\nPERSONA_ALPHA');
	writeFileSync(join(home, 'personas', 'active.md'), 'DERIVED');
	writeFileSync(join(home, 'state.json'), JSON.stringify({ v: 1, persona: 'alpha' }), { mode: 0o600 });
	return home;
};

/* ── settings ─────────────────────────────────────────────────────────── */

test('settings: defaults to exit on close with confirmation; password exposes only hasPassword', () => {
	const home = freshHome('defaults');
	const view = settingsOf(loadState(home).state);
	assert.deepEqual(view.desktop, { exitOnClose: true, confirmOnClose: true });
	assert.equal(view.webdav.dir, 'agent-purge');
	assert.equal(view.webdav.hasPassword, false);
	assert.equal('password' in view.webdav, false, 'Password must never appear in the frontend view');
	assert.equal(desktopExitOnClose(loadState(home).state), true);
});

test('settings: Saving updates only named keys; password is retrievable but not echoed', () => {
	const home = freshHome('save');
	patchState(home, { piAuto: true });
	saveSettings(home, { webdav: { url: ' https://dav.example.com/dav/ ', username: 'admin', password: 's3cret', dir: '/backups/agent-purge/' } });
	saveSettings(home, { desktop: { exitOnClose: false } });

	const { state } = loadState(home);
	assert.equal(state.piAuto, true, 'Other fields must not be erased');
	const view = settingsOf(state);
	assert.equal(view.webdav.url, 'https://dav.example.com/dav/');
	assert.equal(view.webdav.dir, 'backups/agent-purge');
	assert.equal(view.webdav.hasPassword, true);
	assert.equal(settingsWithSecret(state).webdav.password, 's3cret');
	assert.equal(view.desktop.exitOnClose, false);
	assert.equal(view.desktop.confirmOnClose, true, 'Unspecified keys retain their values');
});

test('settings: Empty password clears it; validate URL and directory; normalize and clear GitHub mirror URL', () => {
	const home = freshHome('clear');
	saveSettings(home, { webdav: { url: 'https://dav.example.com', password: 'x' } });
	assert.equal(settingsOf(loadState(home).state).webdav.hasPassword, true);
	saveSettings(home, { webdav: { password: '' } });
	assert.equal(settingsOf(loadState(home).state).webdav.hasPassword, false);
	assert.throws(() => saveSettings(home, { webdav: { url: 'ftp://nope' } }), /http/);
	assert.throws(() => saveSettings(home, { webdav: { dir: '../../etc' } }), /\.\./);

	assert.equal(settingsOf(loadState(home).state).githubMirror, '');
	saveSettings(home, { githubMirror: 'gh-proxy.com/' });
	assert.equal(settingsOf(loadState(home).state).githubMirror, 'https://gh-proxy.com');
	saveSettings(home, { githubMirror: '' });
	assert.equal(settingsOf(loadState(home).state).githubMirror, '');
	assert.throws(() => saveSettings(home, { githubMirror: 'ftp://mirror.invalid' }), /http/);
});

test('settings: theme defaults to auto and supports and validates light/dark/auto', () => {
	const home = freshHome('theme');
	assert.equal(settingsOf(loadState(home).state).theme, 'auto');
	assert.equal(settingsOf({ settings: { theme: 'unexpected' } }).theme, 'auto');

	saveSettings(home, { theme: ' DARK ' });
	assert.equal(settingsOf(loadState(home).state).theme, 'dark');
	saveSettings(home, { desktop: { exitOnClose: false } });
	assert.equal(settingsOf(loadState(home).state).theme, 'dark', 'Saving other settings must not erase theme');

	saveSettings(home, { theme: 'light' });
	assert.equal(settingsOf(loadState(home).state).theme, 'light');
	saveSettings(home, { theme: 'auto' });
	assert.equal(settingsOf(loadState(home).state).theme, 'auto');

	assert.throws(() => saveSettings(home, { theme: 'sepia' }), /auto.*light.*dark/);
	assert.throws(() => saveSettings(home, { theme: 123 }), /string/);
});

/* ── WebDAV：Make real requests to a minimal WebDAV server ────────────────────────────── */

/** Strict WebDAV stub: requires MKCOL per directory before PUT; PROPFIND returns 404 for missing directories. */
function davServer() {
	const files = new Map();
	const collections = new Set(['/dav/']);
	const seen = [];
	const normDir = path => (path.endsWith('/') ? path : `${path}/`);
	const parentOf = path => {
		const trimmed = path.replace(/\/+$/, '');
		const slash = trimmed.lastIndexOf('/');
		return slash <= 0 ? '/' : `${trimmed.slice(0, slash)}/`;
	};
	const server = createServer((req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1');
		seen.push(`${req.method} ${url.pathname}`);
		const auth = req.headers.authorization ?? '';
		if (auth !== `Basic ${Buffer.from('admin:s3cret').toString('base64')}`) {
			res.writeHead(401).end('unauthorized');
			return;
		}
		if (req.method === 'PROPFIND') {
			const dir = normDir(url.pathname);
			if (!collections.has(dir)) { res.writeHead(404).end('missing collection'); return; }
			res.writeHead(207, { 'content-type': 'application/xml' }).end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"/>');
			return;
		}
		if (req.method === 'MKCOL') {
			const dir = normDir(url.pathname);
			if (collections.has(dir)) { res.writeHead(405).end('exists'); return; }
			if (!collections.has(parentOf(dir))) { res.writeHead(409).end('missing parent'); return; }
			collections.add(dir);
			res.writeHead(201).end();
			return;
		}
		if (req.method === 'PUT') {
			if (!collections.has(parentOf(url.pathname))) { res.writeHead(409).end('missing parent'); return; }
			const chunks = [];
			req.on('data', c => chunks.push(c));
			req.on('end', () => { files.set(url.pathname, Buffer.concat(chunks)); res.writeHead(201).end(); });
			return;
		}
		if (req.method === 'GET') {
			const body = files.get(url.pathname);
			if (!body) { res.writeHead(404).end('not found'); return; }
			res.writeHead(200, { 'content-type': 'application/json' }).end(body);
			return;
		}
		res.writeHead(405).end();
	});
	return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
		server, files, seen,
		url: `http://127.0.0.1:${server.address().port}/dav/`,
	})));
}

test('webdav: backup → download → restore round trip excludes the password', async () => {
	const dav = await davServer();
	try {
		const home = freshHome('roundtrip');
		saveSettings(home, { webdav: { url: dav.url, username: 'admin', password: 's3cret', dir: 'agent-purge' } });
		const settings = settingsWithSecret(loadState(home).state);

		// Initial setup: testing connectivity must not report 404 when the remote agent-purge directory is absent.
		const probed = await testConnection(settings);
		assert.equal(probed.ok, true);
		assert.equal(probed.willCreateDir, true);
		assert.deepEqual(remoteUrl(settings.webdav, MANIFEST), `${dav.url}agent-purge/${MANIFEST}`);

		const result = await backup(home, settings);
		assert.equal(result.files, 2, 'Two persona files plus state.json, with active.md excluded, leaving alpha.md and state.json');
		const archive = JSON.parse(dav.files.get(`/dav/agent-purge/${MANIFEST}`).toString('utf8'));
		const stateEntry = archive.entries.find(e => e.path === 'state.json');
		assert.equal(stateEntry.sha256, createHash('sha256').update(Buffer.from(stateEntry.base64, 'base64')).digest('hex'));
		const uploadedState = JSON.parse(Buffer.from(stateEntry.base64, 'base64').toString('utf8'));
		assert.equal(uploadedState.settings.webdav.password, undefined, 'Backups must not contain the plaintext password');
		assert.equal(archive.entries.some(e => e.path === 'personas/active.md'), false, 'Derived files are excluded from backups');

		// Change local data, then restore from remote.
		writeFileSync(join(home, 'personas', 'alpha.md'), 'LOCAL_EDIT');
		saveSettings(home, { desktop: { exitOnClose: false } });
		const restored = await restore(home, settings);
		assert.equal(restored.written.includes('personas/alpha.md'), true);
		assert.equal(readFileSync(join(home, 'personas', 'alpha.md'), 'utf8'), '---\nid: alpha\nname: Alpha\n---\nPERSONA_ALPHA');
		// The password belongs to this machine: it is absent from backups and remains usable after restore.
		assert.equal(settingsWithSecret(loadState(home).state).webdav.password, 's3cret');
		assert.ok(restored.snapshot && readdirSync(join(home, 'backups')).length === 1, 'A local snapshot must be kept before restore');
	} finally {
		await new Promise(r => dav.server.close(r));
	}
});

test('webdav: authentication failure, missing backup and hash mismatch must give readable errors without writing', async () => {
	const dav = await davServer();
	try {
		const home = freshHome('errors');
		const wrong = { url: dav.url, username: 'admin', password: 'nope', dir: 'agent-purge' };
		await assert.rejects(testConnection(wrong), /401\/403/);
		await assert.rejects(download(wrong), /401\/403/);

		const settings = settingsWithSecret({ settings: { webdav: { url: dav.url, username: 'admin', password: 's3cret', dir: 'agent-purge' } } });
		await assert.rejects(download(settings), /No agent-purge backup found/);

		// Alter one byte → verification fails and local files remain unchanged.
		await backup(home, settings);
		const archive = JSON.parse(dav.files.get(`/dav/agent-purge/${MANIFEST}`).toString('utf8'));
		archive.entries[0].base64 = Buffer.from('TAMPERED').toString('base64');
		dav.files.set(`/dav/agent-purge/${MANIFEST}`, Buffer.from(JSON.stringify(archive)));
		const before = readFileSync(join(home, 'personas', archive.entries[0].path.split('/')[1]), 'utf8');
		await assert.rejects(restore(home, settings), /verification failed/);
		assert.equal(readFileSync(join(home, 'personas', archive.entries[0].path.split('/')[1]), 'utf8'), before);
	} finally {
		await new Promise(r => dav.server.close(r));
	}
});

test('webdav: backup paths must stay within the persona and configuration file scope', () => {
	const home = freshHome('paths');
	const malicious = {
		archive: { format: 1, createdAt: '2026-01-01T00:00:00.000Z' },
		entries: [{ path: '../../evil.md', bytes: Buffer.from('x') }],
	};
	assert.throws(() => applyArchive(home, malicious, { snapshotBefore: false }), /Unrecognized path/);
});

test('webdav: retain only recent snapshots', () => {
	const home = freshHome('prune');
	const dir = join(home, 'backups');
	mkdirSync(dir, { recursive: true });
	for (let i = 0; i < 14; i += 1) writeFileSync(join(dir, `pre-restore-${String(i).padStart(2, '0')}.json`), '{}');
	assert.equal(pruneSnapshots(home, 10), 4);
	assert.equal(readdirSync(dir).length, 10);
});

test('webdav: use MKCOL per nested directory and history without duplicating dir', async () => {
	const dav = await davServer();
	try {
		const home = freshHome('nested-mkcol');
		saveSettings(home, { webdav: { url: dav.url, username: 'admin', password: 's3cret', dir: 'team/agent-purge' } });
		const settings = settingsWithSecret(loadState(home).state);
		const result = await backup(home, settings);
		assert.equal(result.ok, true);
		assert.ok(dav.files.has('/dav/team/agent-purge/agent-purge-backup.json'));
		assert.ok([...dav.files.keys()].some(p => p.startsWith('/dav/team/agent-purge/history/agent-purge-')));
		assert.ok(dav.seen.includes('MKCOL /dav/team/'));
		assert.ok(dav.seen.includes('MKCOL /dav/team/agent-purge/'));
		assert.ok(dav.seen.includes('MKCOL /dav/team/agent-purge/history/'));
		assert.equal(dav.seen.some(line => line.includes('MKCOL /dav/team/agent-purge/team/')), false, 'MKCOL must not duplicate the directory name');
	} finally {
		await new Promise(r => dav.server.close(r));
	}
});
