import { defineConfig } from "vitepress";

const REPO = "https://github.com/ZiChuanLan/agent-purge";

export default defineConfig({
	lang: "zh-CN",
	title: "agent-purge",
	description: "One persona for multiple local coding agents.",
	base: "/agent-purge/",
	cleanUrls: true,
	head: [
		["link", { rel: "icon", type: "image/svg+xml", href: "/agent-purge/images/logo.svg" }],
		["meta", { name: "theme-color", content: "#0b0f14" }],
	],
	// LICENSE points to the repository root and is shared by README and LEGAL; it is not a site route.
	ignoreDeadLinks: [/LICENSE$/],
	sitemap: { hostname: "https://zichuanlan.github.io/agent-purge/" },

	locales: {
		root: {
			label: "English (root)",
			lang: "zh-CN",
			themeConfig: {
				nav: [
					{ text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
					{ text: "Reference", link: "/reference/support", activeMatch: "/reference/" },
					{ text: "Release notes", link: "/releases/v0.2.29" },
					{ text: "Legal", link: "/LEGAL" },
				],
				sidebar: {
					"/guide/": [
						{
							text: "Guide",
							items: [
								{ text: "Getting started", link: "/guide/getting-started" },
								{ text: "Personas and modes", link: "/guide/personas-and-modes" },
								{ text: "Console", link: "/guide/interfaces" },
								{ text: "Scope", link: "/guide/scope" },
								{ text: "Pause and uninstall", link: "/guide/pause-and-uninstall" },
							],
						},
					],
					"/reference/": [
						{
							text: "Reference",
							items: [
								{ text: "Support matrix", link: "/reference/support" },
								{ text: "Compatibility and known limits", link: "/reference/compatibility" },
								{ text: "CLI reference", link: "/reference/cli" },
								{ text: "Architecture", link: "/reference/architecture" },
							],
						},
						{
							text: "Release",
							items: [{ text: "Release process", link: "/releasing" }],
						},
					],
				},
				editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
				lastUpdated: { text: "Last updated" },
				docFooter: { prev: "Previous page", next: "Next page" },
				outline: { label: "On this page", level: [2, 3] },
				langMenuLabel: "Change language",
				darkModeSwitchLabel: "Appearance",
				sidebarMenuLabel: "Menu",
				returnToTopLabel: "Return to top",
			},
		},
		en: {
			label: "English",
			lang: "en-US",
			link: "/en/",
			themeConfig: {
				nav: [
					{ text: "Guide", link: "/en/guide/getting-started", activeMatch: "/en/guide/" },
					{ text: "Reference", link: "/en/reference/support", activeMatch: "/en/reference/" },
					{ text: "Legal", link: "/en/LEGAL" },
				],
				sidebar: {
					"/en/guide/": [
						{
							text: "Guide",
							items: [
								{ text: "Getting started", link: "/en/guide/getting-started" },
								{ text: "Personas and modes", link: "/en/guide/personas-and-modes" },
								{ text: "Console", link: "/en/guide/interfaces" },
								{ text: "Scope", link: "/en/guide/scope" },
								{ text: "Pause and uninstall", link: "/en/guide/pause-and-uninstall" },
							],
						},
					],
					"/en/reference/": [
						{
							text: "Reference",
							items: [
								{ text: "Support matrix", link: "/en/reference/support" },
								{ text: "Compatibility and limits", link: "/reference/compatibility" },
								{ text: "CLI reference", link: "/reference/cli" },
								{ text: "Architecture", link: "/reference/architecture" },
							],
						},
					],
				},
				editLink: { pattern: `${REPO}/edit/main/docs/en/:path`, text: "Edit this page on GitHub" },
				lastUpdated: { text: "Last updated" },
				outline: { label: "On this page", level: [2, 3] },
				langMenuLabel: "Change language",
				darkModeSwitchLabel: "Appearance",
				sidebarMenuLabel: "Menu",
				returnToTopLabel: "Return to top",
			},
		},
		ja: {
			label: "English (legacy Japanese)",
			lang: "ja-JP",
			link: "/ja/",
			themeConfig: {
				nav: [
					{ text: "Guide", link: "/ja/guide/getting-started", activeMatch: "/ja/guide/" },
					{ text: "Reference", link: "/ja/reference/support", activeMatch: "/ja/reference/" },
					{ text: "Legal", link: "/ja/LEGAL" },
				],
				sidebar: {
					"/ja/guide/": [
						{
							text: "Guide",
							items: [
								{ text: "Getting started", link: "/ja/guide/getting-started" },
								{ text: "Personas and modes", link: "/ja/guide/personas-and-modes" },
								{ text: "Console", link: "/ja/guide/interfaces" },
								{ text: "Scope", link: "/ja/guide/scope" },
								{ text: "Pause and uninstall", link: "/ja/guide/pause-and-uninstall" },
							],
						},
					],
					"/ja/reference/": [
						{
							text: "Reference",
							items: [
								{ text: "Support matrix", link: "/ja/reference/support" },
								{ text: "Compatibility and limits", link: "/reference/compatibility" },
								{ text: "CLI reference", link: "/reference/cli" },
								{ text: "Architecture", link: "/reference/architecture" },
							],
						},
					],
				},
				editLink: { pattern: `${REPO}/edit/main/docs/ja/:path`, text: "Edit this page on GitHub" },
				lastUpdated: { text: "Last updated" },
				outline: { label: "On this page", level: [2, 3] },
				langMenuLabel: "Change language",
				darkModeSwitchLabel: "Appearance",
				sidebarMenuLabel: "Menu",
				returnToTopLabel: "Return to top",
			},
		},
	},

	themeConfig: {
		logo: "/images/logo.svg",
		socialLinks: [{ icon: "github", link: REPO }],
		search: {
			provider: "local",
			options: {
				locales: {
					root: { translations: { button: { buttonText: "Search docs", buttonAriaLabel: "Search docs" } } },
					en: { translations: { button: { buttonText: "Search", buttonAriaLabel: "Search docs" } } },
					ja: { translations: { button: { buttonText: "Search", buttonAriaLabel: "Search docs" } } },
				},
			},
		},
		footer: {
			message: "Local prompt and persona orchestration console",
			copyright: "MIT Licensed",
		},
	},
});
