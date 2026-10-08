# Third-party notices

No project-wide license has been selected for E1 Code source or its supplied logo. Publishing the repository does not relicense third-party software or artwork.

Runtime and development dependencies are declared in `package.json` and pinned in `package-lock.json`. Their upstream licenses continue to apply. In particular, `npm ci` copies these browser assets and their license files into the ignored `src/ui/vendor/` directory:

| Package | License | Upstream |
| --- | --- | --- |
| marked | MIT | https://github.com/markedjs/marked |
| DOMPurify | Apache-2.0 OR MPL-2.0 | https://github.com/cure53/DOMPurify |
| @xterm/xterm | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-fit | MIT | https://github.com/xtermjs/xterm.js |

`node-pty` is MIT licensed; its package contains additional notices for platform-specific components. Build tools and their transitive dependencies carry their own license files in `node_modules/`.

Claude Desktop, Claude Code, and provider services are separately supplied products. Their application code, binaries, fonts, and original logo artwork are not distributed in this repository. The native adapter scripts refer to local application structures and must be reviewed when the supplied application version changes.
