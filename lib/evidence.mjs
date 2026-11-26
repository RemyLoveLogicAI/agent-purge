// Pure evidence model shared by the Web UI and Node control plane.
// An isolated capability test is never proof about an already-running session.
const array = value => Array.isArray(value) ? value : [];
const mainRequests = mode => array(mode?.requests).filter(request => request && (request.kind === undefined || request.kind === 'main'));
export const privilegedHit = request => Number(request?.markerCount) > 0 &&
  array(request?.roles).some(role => role === 'system' || role === 'developer');
export const sysHit = result => array(result?.modes).some(mode => mainRequests(mode).some(privilegedHit));

export function captureScopeLabel(scope) {
  if (scope?.kind === 'isolated-cli') return `Isolated CLI${scope.profile ? ` (${scope.profile})` : ''}`;
  if (scope?.kind === 'isolated-session') return `Isolated same session${scope.profile ? ` (${scope.profile})` : ''}`;
  return 'Historical isolated test (entry point not recorded)';
}

export function verificationEvidence(result) {
  const view = (state, label, kind = 'warn') => ({ state, label, kind, runtimeConfirmed: false });
  if (!result) return view('not-tested', 'Not tested', '');
  if (['missing', 'unavailable'].includes(result.status)) return view('unavailable', 'Entry point not found');
  if (result.status === 'blocked') return view('blocked', 'Verification blocked');
  if (result.status === 'error') return view('error', 'Verification error');
  if (result.status === 'no-request') return view('no-request', 'No request captured');
  const modes = array(result.modes);
  if (!modes.length) return view('invalid', 'No valid evidence');
  if (modes.some(m => m?.timedOut || (m?.exitCode !== undefined && m.exitCode !== 0) || m?.status === 'error'))
    return view('error', 'Verification error');
  const hasRequests = modes.some(m => mainRequests(m).length > 0);
  if (!hasRequests) return view('no-request', 'No request captured');
  if (modes.some(m => !mainRequests(m).length || m?.status === 'no-request'))
    return view('partial', 'Verification incomplete');
  if (modes.every(m => m?.mode === 'off')) {
    return modes.every(m => m.status === 'captured' && mainRequests(m).every(r => r.markerCount === 0))
      ? view('off-verified', 'Pause verified', 'blue') : view('mismatch', 'Residual content remains while paused');
  }
  const active = modes.filter(m => m?.mode !== 'off');
  const hits = active.flatMap(mainRequests);
  if (!hits.some(privilegedHit)) return view('miss', 'Request missed');
  if (result.status !== 'captured' || modes.some(m => m?.status !== 'captured') ||
      hits.some(r => !privilegedHit(r) || r.markerCount !== 1))
    return view('partial', 'Request partially matched');
  return view('verified', 'Isolated test matched', 'good');
}
