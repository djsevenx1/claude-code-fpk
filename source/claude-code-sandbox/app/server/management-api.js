/*
 * Claude Code 沙箱 - Web 管理控制台后端
 * v1.3.0
 *
 * 设计原则（学 OpenClaw management-api.js）：
 *   - 用 Node.js 原生 http 模块，零依赖，避免在 FPK 里再装 Express
 *   - 只监听 lo（127.0.0.1），外部走 fnOS 反代/iframe 进入（不再额外开放端口）
 *   - 鉴权：与 ttyd 共享同一套用户名/密码（从 .env 读），不传则不鉴权
 *     （fnOS 桌面本身已经登录，loopback + 同源天然挡一道）
 *   - 所有控制操作都通过调用 /var/apps/.../cmd/main 走 bash，保持唯一入口
 *   - 静态服务：把 app/ui/management.html 暴露为 /，把 /api/* 留给 REST
 *
 * 关键路径（env 注入，install_callback 把这些写到 .env 里）：
 *   TRIM_APPDEST  = /var/apps/claude-code-sandbox/target
 *   TRIM_PKGETC   = /var/apps/claude-code-sandbox/etc
 *   TRIM_PKGVAR   = /var/apps/claude-code-sandbox/var
 *   TRIM_PKGHOME  = /var/apps/claude-code-sandbox/home
 *   MANAGEMENT_PORT = 7682
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { execFile, spawn } = require('child_process');

const PORT        = parseInt(process.env.MANAGEMENT_PORT || '7682', 10);
const HOST        = '127.0.0.1';
const APP_DEST    = process.env.TRIM_APPDEST  || '/var/apps/claude-code-sandbox/target';
const PKG_ETC     = process.env.TRIM_PKGETC   || '/var/apps/claude-code-sandbox/etc';
const PKG_VAR     = process.env.TRIM_PKGVAR   || '/var/apps/claude-code-sandbox/var';
const PKG_HOME    = process.env.TRIM_PKGHOME  || '/var/apps/claude-code-sandbox/home';
const PKG_USERNAME= process.env.TRIM_USERNAME || 'claude-code-sandbox';
const ENV_FILE    = path.join(PKG_ETC,   'claude.env');
const PID_FILE    = path.join(PKG_VAR,   'ttyd.pid');
const LOG_FILE    = path.join(PKG_VAR,   'info.log');
const UI_DIR      = path.join(APP_DEST,  'app', 'ui');
const MAIN_SCRIPT = path.join(APP_DEST,  'cmd', 'main');
const SETTINGS    = path.join(PKG_HOME,  'home', '.claude', 'settings.json');
const CLAUDE_BIN  = path.join(APP_DEST,  'node_modules', '.bin', 'claude');

const VERSION     = '1.3.0';

// ---------- 通用工具 ----------

function ts() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function logLine(msg) {
    const line = `[${ts()}] [mgmt-api] ${msg}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
    process.stderr.write(line);
}

function readEnv() {
    // 简单解析 .env（支持 %q 引号风格）
    const env = {};
    if (!fs.existsSync(ENV_FILE)) return env;
    const txt = fs.readFileSync(ENV_FILE, 'utf8');
    for (const raw of txt.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const k = line.slice(0, eq).trim();
        let v = line.slice(eq + 1).trim();
        // 处理 bash %q 风格（外层单引号 + 内部 \' 替换为 '）
        if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
            v = v.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        }
        env[k] = v;
    }
    return env;
}

function maskValue(v) {
    if (!v) return '';
    if (v.length <= 8) return '****';
    return v.slice(0, 4) + '****' + v.slice(-4);
}

function isTtydRunning() {
    try {
        if (!fs.existsSync(PID_FILE)) return { running: false, pid: null };
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (!pid) return { running: false, pid: null };
        process.kill(pid, 0);  // 探测，不发信号
        return { running: true, pid };
    } catch (_) {
        return { running: false, pid: null };
    }
}

function getTtydStartedAt() {
    try {
        if (!fs.existsSync(PID_FILE)) return null;
        const st = fs.statSync(PID_FILE);
        return st.mtime.toISOString();
    } catch (_) { return null; }
}

function getClaudeVersion() {
    return new Promise((resolve) => {
        if (!fs.existsSync(CLAUDE_BIN)) return resolve(null);
        execFile(CLAUDE_BIN, ['--version'], { timeout: 10 }, (err, stdout) => {
            if (err) return resolve(null);
            resolve((stdout || '').trim() || null);
        });
    });
}

function getTtydPort() {
    const env = readEnv();
    return parseInt(env.TTYD_PORT || '7681', 10);
}

function ttydUptimeSeconds() {
    const started = getTtydStartedAt();
    if (!started) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(started).getTime()) / 1000));
}

function uptimeHuman(sec) {
    if (!sec) return '0s';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    if (s && !d) parts.push(s + 's');
    return parts.join(' ');
}

function callMain(action) {
    return new Promise((resolve) => {
        if (!fs.existsSync(MAIN_SCRIPT)) {
            return resolve({ ok: false, error: `cmd/main 不存在: ${MAIN_SCRIPT}` });
        }
        execFile('bash', [MAIN_SCRIPT, action], { timeout: 30 }, (err, stdout, stderr) => {
            // main 的 exit code: 0 = 成功, 3 = not running (status 专用), 其他 = 失败
            resolve({
                ok: !err,
                code: err ? err.code : 0,
                stdout: (stdout || '').trim(),
                stderr: (stderr || '').trim()
            });
        });
    });
}

// ---------- HTTP 工具 ----------

function json(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
}

function text(res, status, body, ctype) {
    res.writeHead(status, {
        'Content-Type': ctype || 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function methodNotAllowed(res, allow) {
    res.writeHead(405, {
        'Allow': allow.join(', '),
        'Content-Type': 'text/plain'
    });
    res.end('Method Not Allowed');
}

function notFound(res) {
    text(res, 404, 'Not Found');
}

function badRequest(res, msg) {
    json(res, 400, { ok: false, error: msg });
}

// Basic 鉴权（与 ttyd 共享 .env 里的 TTYD_USER / TTYD_PASSWORD）
function checkAuth(req) {
    const env = readEnv();
    const wantUser = env.TTYD_USER;
    const wantPass = env.TTYD_PASSWORD;
    // 两者都空 = 不鉴权（loopback 信任）
    if (!wantUser && !wantPass) return true;

    const hdr = req.headers['authorization'] || '';
    if (!hdr.startsWith('Basic ')) return false;
    let decoded = '';
    try { decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8'); }
    catch (_) { return false; }
    const idx = decoded.indexOf(':');
    const u = idx < 0 ? decoded : decoded.slice(0, idx);
    const p = idx < 0 ? ''     : decoded.slice(idx + 1);
    return u === wantUser && p === wantPass;
}

function unauthorized(res) {
    res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="Claude Code Console"',
        'Content-Type': 'text/plain'
    });
    res.end('Unauthorized');
}

// ---------- API 路由 ----------

// GET /api/health
async function apiHealth(req, res) {
    json(res, 200, { ok: true, version: VERSION, time: new Date().toISOString() });
}

// GET /api/status
async function apiStatus(req, res) {
    const t = isTtydRunning();
    const port = getTtydPort();
    const version = await getClaudeVersion();
    const env = readEnv();

    json(res, 200, {
        ok: true,
        version,
        ttyd: {
            running: t.running,
            pid: t.pid,
            port,
            startedAt: getTtydStartedAt(),
            uptimeSeconds: t.running ? ttydUptimeSeconds() : 0,
            uptimeHuman: t.running ? uptimeHuman(ttydUptimeSeconds()) : '0s'
        },
        app: {
            name: 'claude-code-sandbox',
            version: VERSION,
            arch: process.arch,
            nodeVersion: process.version,
            platform: process.platform,
            hostname: os.hostname(),
            uptimeSeconds: Math.floor(process.uptime()),
            loadavg: os.loadavg()
        },
        paths: {
            APP_DEST, PKG_ETC, PKG_VAR, PKG_HOME,
            ENV_FILE, LOG_FILE, PID_FILE
        },
        config: {
            hasApiKey:      !!env.ANTHROPIC_API_KEY,
            hasAuthToken:   !!env.ANTHROPIC_AUTH_TOKEN,
            baseUrl:        env.ANTHROPIC_BASE_URL || '',
            model:          env.ANTHROPIC_MODEL    || 'claude-sonnet-4-5',
            ttydUser:       env.TTYD_USER          || '',
            hasTtydPassword:!!env.TTYD_PASSWORD,
            ttydPort:       port
        }
    });
}

// GET /api/config - 读 .env（敏感字段遮罩）
async function apiGetConfig(req, res) {
    const env = readEnv();
    const masked = { ...env };
    for (const k of ['TTYD_PASSWORD', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
        if (masked[k]) masked[k] = maskValue(masked[k]);
    }
    json(res, 200, { ok: true, config: masked, raw: env });
}

// POST /api/config - 改 .env
// body: { TTYD_USER, TTYD_PASSWORD, TTYD_PORT, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN }
// 留空字符串 = 不改；"__CLEAR__" = 删字段
async function apiSetConfig(req, res) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 64 * 1024) { req.destroy(); } });
    req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body || '{}'); }
        catch (_) { return badRequest(res, 'JSON 解析失败'); }

        const allowed = [
            'TTYD_USER', 'TTYD_PASSWORD', 'TTYD_PORT',
            'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL',
            'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'
        ];
        const current = readEnv();
        const next = { ...current };
        for (const k of allowed) {
            if (!(k in payload)) continue;
            const v = String(payload[k] == null ? '' : payload[k]);
            if (v === '__CLEAR__') {
                delete next[k];
            } else if (v === '') {
                // 留空 = 不改原值
            } else {
                next[k] = v;
            }
        }

        // 端口范围校验
        if (next.TTYD_PORT != null) {
            const p = parseInt(next.TTYD_PORT, 10);
            if (!Number.isInteger(p) || p < 1 || p > 65535) {
                return badRequest(res, `TTYD_PORT 非法: ${next.TTYD_PORT}`);
            }
            next.TTYD_PORT = String(p);
        }

        // 用 bash %q 风格写回
        const lines = [];
        for (const k of Object.keys(next)) {
            // 简单 escape：单引号包裹，内部单引号用 '\'' 闭合
            const v = String(next[k]).replace(/'/g, `'\\''`);
            lines.push(`${k}='${v}'`);
        }
        try {
            fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
            fs.chmodSync(ENV_FILE, 0o600);
        } catch (e) {
            return json(res, 500, { ok: false, error: '写 .env 失败: ' + e.message });
        }

        // 修正属主
        if (process.getuid && process.getuid() === 0) {
            try {
                const { execSync } = require('child_process');
                execSync(`chown ${PKG_USERNAME}:${PKG_USERNAME} "${ENV_FILE}"`);
            } catch (_) {}
        }

        logLine('config updated via API');
        json(res, 200, { ok: true, config: maskEnv(next) });
    });
}

function maskEnv(env) {
    const m = { ...env };
    for (const k of ['TTYD_PASSWORD', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
        if (m[k]) m[k] = maskValue(m[k]);
    }
    return m;
}

// GET /api/logs?lines=200
async function apiLogs(req, res) {
    const url = new URL(req.url, 'http://x');
    const n = Math.min(2000, Math.max(10, parseInt(url.searchParams.get('lines') || '200', 10)));
    if (!fs.existsSync(LOG_FILE)) {
        return json(res, 200, { ok: true, lines: [], logFile: LOG_FILE });
    }
    const txt = fs.readFileSync(LOG_FILE, 'utf8');
    const all = txt.split(/\r?\n/);
    const tail = all.slice(Math.max(0, all.length - n));
    json(res, 200, { ok: true, lines: tail, total: all.length, logFile: LOG_FILE });
}

// GET /api/processes - 当前进程列表（限定 ttyd/claude/management-api）
async function apiProcesses(req, res) {
    const { execSync } = require('child_process');
    try {
        const out = execSync(
            `ps -eo pid,etime,rss,user,comm,args --sort=-rss 2>/dev/null | ` +
            `awk 'NR==1 || /ttyd|claude|management-api/'`,
            { encoding: 'utf8', timeout: 5 }
        );
        text(res, 200, out, 'text/plain; charset=utf-8');
    } catch (e) {
        text(res, 500, 'ps failed: ' + e.message);
    }
}

// GET /api/disk - 磁盘占用
async function apiDisk(req, res) {
    const { execSync } = require('child_process');
    const targets = [
        { name: 'target (app)', path: APP_DEST },
        { name: 'etc',         path: PKG_ETC  },
        { name: 'var (logs)',  path: PKG_VAR  },
        { name: 'home',        path: PKG_HOME },
    ];
    const out = [];
    for (const t of targets) {
        try {
            const du = execSync(`du -sh "${t.path}" 2>/dev/null | awk '{print $1}'`, { encoding: 'utf8', timeout: 30 }).trim();
            out.push({ name: t.name, path: t.path, size: du || '?' });
        } catch (e) {
            out.push({ name: t.name, path: t.path, size: 'err: ' + e.message });
        }
    }
    json(res, 200, { ok: true, items: out });
}

// POST /api/restart - 重启 ttyd
// POST /api/stop    - 停止 ttyd
// POST /api/start   - 启动 ttyd
async function apiControl(req, res, action) {
    const result = await callMain(action);
    if (result.ok || result.code === 3) {
        logLine(`control: ${action} -> ok`);
        json(res, 200, { ok: true, action, ...result });
    } else {
        logLine(`control: ${action} -> fail (${result.code})`);
        json(res, 500, { ok: false, action, ...result });
    }
}

// GET /api/settings - 读 ~/.claude/settings.json
async function apiGetSettings(req, res) {
    if (!fs.existsSync(SETTINGS)) return json(res, 200, { ok: true, exists: false, content: null });
    try {
        const raw = fs.readFileSync(SETTINGS, 'utf8');
        const obj = JSON.parse(raw);
        // 遮罩 env 里的敏感字段
        if (obj.env) {
            for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
                if (obj.env[k]) obj.env[k] = maskValue(obj.env[k]);
            }
        }
        json(res, 200, { ok: true, exists: true, content: obj });
    } catch (e) {
        json(res, 500, { ok: false, error: '解析 settings.json 失败: ' + e.message });
    }
}

// ---------- 静态文件 ----------

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.map':  'application/json'
};

function serveStatic(req, res, urlPath) {
    let rel = urlPath === '/' ? '/management.html' : urlPath;
    // 安全：阻止 ..
    if (rel.indexOf('..') >= 0) return notFound(res);
    const full = path.join(UI_DIR, rel);
    if (!full.startsWith(UI_DIR)) return notFound(res);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        // fallback 到 management.html（SPA 友好）
        const fallback = path.join(UI_DIR, 'management.html');
        if (fs.existsSync(fallback)) {
            return fs.createReadStream(fallback).pipe(res.writeHead(200, {
                'Content-Type': MIME['.html'],
                'Cache-Control': 'no-store'
            }));
        }
        return notFound(res);
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
    });
    fs.createReadStream(full).pipe(res);
}

// ---------- 路由分发 ----------

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    // 鉴权（health 不需要，方便 fnOS 探活）
    if (p !== '/api/health' && !checkAuth(req)) {
        return unauthorized(res);
    }

    // API
    if (p.startsWith('/api/')) {
        const route = p.slice(5);
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            return res.end();
        }
        switch (route) {
            case 'health':     return req.method === 'GET' ? apiHealth(req, res) : methodNotAllowed(res, ['GET']);
            case 'status':     return req.method === 'GET' ? apiStatus(req, res) : methodNotAllowed(res, ['GET']);
            case 'config':     return apiConfigRoute(req, res);
            case 'logs':       return req.method === 'GET' ? apiLogs(req, res) : methodNotAllowed(res, ['GET']);
            case 'processes':  return req.method === 'GET' ? apiProcesses(req, res) : methodNotAllowed(res, ['GET']);
            case 'disk':       return req.method === 'GET' ? apiDisk(req, res) : methodNotAllowed(res, ['GET']);
            case 'settings':   return req.method === 'GET' ? apiGetSettings(req, res) : methodNotAllowed(res, ['GET']);
            case 'restart':    return req.method === 'POST' ? apiControl(req, res, 'restart') : methodNotAllowed(res, ['POST']);
            case 'stop':       return req.method === 'POST' ? apiControl(req, res, 'stop') : methodNotAllowed(res, ['POST']);
            case 'start':      return req.method === 'POST' ? apiControl(req, res, 'start') : methodNotAllowed(res, ['POST']);
            default: return notFound(res);
        }
    }

    // 静态
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD']);
    serveStatic(req, res, p);
});

function apiConfigRoute(req, res) {
    if (req.method === 'GET')  return apiGetConfig(req, res);
    if (req.method === 'POST') return apiSetConfig(req, res);
    return methodNotAllowed(res, ['GET', 'POST']);
}

server.on('clientError', (err, socket) => {
    logLine('clientError: ' + err.message);
    if (socket.writable) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
});

server.listen(PORT, HOST, () => {
    logLine(`listening on http://${HOST}:${PORT}  (version=${VERSION})`);
    logLine(`ENV_FILE=${ENV_FILE}`);
    logLine(`LOG_FILE=${LOG_FILE}`);
});

process.on('SIGTERM', () => { logLine('SIGTERM, exiting'); server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { logLine('SIGINT, exiting');  server.close(() => process.exit(0)); });
