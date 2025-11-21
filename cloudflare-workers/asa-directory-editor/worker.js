// worker.js
// ASA CODE-HARMONIZER – B verzió
// - Cloudflare Worker
// - ASA MATRIX mini UI (triple black + dark turquoise + cyan green)
// - /api/harmonize -> GitHub PR generálás

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Healthcheck
    if (path === "/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "ASA_CODE_HARMONIZER" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // API: harmonizálás + PR
    if (path === "/api/harmonize" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));

        const title =
          body.title || "ASA CODE-HARMONIZER – automatic harmonization";
        const description =
          body.description ||
          "PR created by ASA CODE-HARMONIZER worker (B layout).";
        const paths = body.paths || [];
        const caller = body.caller || "ASA_MATRIX_UI";

        const owner = env.GITHUB_OWNER;
        const repo = env.GITHUB_REPO;
        const baseBranch = env.BASE_BRANCH || "main";
        const token = env.GITHUB_TOKEN;

        if (!owner || !repo || !token) {
          return new Response(
            JSON.stringify({
              ok: false,
              error:
                "Missing GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN env vars in Cloudflare Worker.",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        // 1) Base branch SHA lekérése
        const baseRefResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`,
          {
            headers: githubHeaders(token),
          }
        );

        if (!baseRefResp.ok) {
          const txt = await baseRefResp.text();
          return new Response(
            JSON.stringify({
              ok: false,
              step: "get_base_ref",
              status: baseRefResp.status,
              body: txt,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        const baseRef = await baseRefResp.json();
        const baseSha = baseRef.object.sha;

        // 2) Új branch létrehozása
        const branchName = `asa-harmonizer-${Date.now()}`;
        const createRefResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/refs`,
          {
            method: "POST",
            headers: githubHeaders(token),
            body: JSON.stringify({
              ref: `refs/heads/${branchName}`,
              sha: baseSha,
            }),
          }
        );

        if (!createRefResp.ok) {
          const txt = await createRefResp.text();
          return new Response(
            JSON.stringify({
              ok: false,
              step: "create_ref",
              status: createRefResp.status,
              body: txt,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        // 3) Egy "touchpoint" file commit – ide írjuk a harmonizáció meta infóit
        const filePath = `asa_harmonizer/ASA_HARMONIZER_${Date.now()}.md`;

        const markdownContent = [
          "# ASA CODE-HARMONIZER",
          "",
          `Created at: ${new Date().toISOString()}`,
          `Caller: ${caller}`,
          "",
          "## Target paths",
          "",
          ...(paths.length ? paths.map((p) => `- \`${p}\``) : ["- (none)"]),
          "",
          "## Notes",
          "",
          description,
        ].join("\n");

        const contentBase64 = toBase64(markdownContent);

        const putFileResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
            filePath
          )}`,
          {
            method: "PUT",
            headers: githubHeaders(token),
            body: JSON.stringify({
              message: `ASA CODE-HARMONIZER touchpoint for ${branchName}`,
              content: contentBase64,
              branch: branchName,
            }),
          }
        );

        if (!putFileResp.ok) {
          const txt = await putFileResp.text();
          return new Response(
            JSON.stringify({
              ok: false,
              step: "create_file",
              status: putFileResp.status,
              body: txt,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        // 4) PR létrehozása
        const prResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls`,
          {
            method: "POST",
            headers: githubHeaders(token),
            body: JSON.stringify({
              title,
              head: branchName,
              base: baseBranch,
              body:
                description +
                "\n\n> Automatically generated by ASA CODE-HARMONIZER Worker.\n",
            }),
          }
        );

        if (!prResp.ok) {
          const txt = await prResp.text();
          return new Response(
            JSON.stringify({
              ok: false,
              step: "create_pr",
              status: prResp.status,
              body: txt,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        const prJson = await prResp.json();

        return new Response(
          JSON.stringify({
            ok: true,
            branch: branchName,
            filePath,
            pr_url: prJson.html_url,
            pr_number: prJson.number,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: String(err),
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // UI – ASA MATRIX vortex / CIAN panel – 1 gombos, 1 endpoint
    if (path === "/" && request.method === "GET") {
      return new Response(renderUiHtml(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

// ---- Helpers ----

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ASA-CODE-HARMONIZER",
  };
}

function toBase64(str) {
  // CF Worker környezetben btoa elérhető
  return btoa(unescape(encodeURIComponent(str)));
}

// Triple black + dark turquoise + cyan green, vortex animációs háttér
function renderUiHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ASA CODE-HARMONIZER</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --asa-black: #02040a;
      --asa-black-soft: #050814;
      --asa-turquoise: #00c7c0;
      --asa-cyan-green: #00ff9f;
      --asa-glow-soft: rgba(0, 255, 159, 0.3);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text",
        "Inter", sans-serif;
      background: radial-gradient(circle at 10% 0%, #02101a 0, #02040a 45%, #000 100%);
      color: #e9fefc;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      overflow: hidden;
    }

    .vortex {
      position: fixed;
      inset: -20%;
      background:
        radial-gradient(circle at 20% 0%, rgba(0, 199, 192, 0.12), transparent 60%),
        radial-gradient(circle at 80% 100%, rgba(0, 255, 159, 0.18), transparent 65%),
        radial-gradient(circle at 50% 50%, rgba(0, 199, 192, 0.18), transparent 55%);
      filter: blur(6px);
      opacity: 0.9;
      animation: vortex 16s linear infinite alternate;
      pointer-events: none;
      z-index: 0;
    }

    @keyframes vortex {
      0% {
        transform: scale(1.1) rotate(0deg) translate3d(0,0,0);
      }
      50% {
        transform: scale(1.15) rotate(6deg) translate3d(0,-8px,0);
      }
      100% {
        transform: scale(1.1) rotate(-6deg) translate3d(0,8px,0);
      }
    }

    .card {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 480px;
      background: linear-gradient(145deg, rgba(2,4,10,0.9), rgba(5,8,20,0.96));
      border-radius: 22px;
      padding: 20px 20px 18px;
      box-shadow:
        0 0 0 1px rgba(0, 199, 192, 0.28),
        0 22px 60px rgba(0, 0, 0, 0.85),
        0 0 60px rgba(0, 199, 192, 0.24);
      backdrop-filter: blur(14px);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-mark {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      background: radial-gradient(circle at 30% 0%, #00ff9f, #00c7c0 60%, #02040a 100%);
      box-shadow:
        0 0 22px rgba(0, 255, 159, 0.8),
        0 0 50px rgba(0, 199, 192, 0.9);
      position: relative;
      overflow: hidden;
    }

    .brand-mark::before {
      content: "";
      position: absolute;
      inset: 24%;
      border-radius: inherit;
      border: 2px solid rgba(2, 4, 10, 0.9);
      box-shadow: 0 0 18px rgba(0,0,0,0.9);
    }

    .brand-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .brand-title {
      font-size: 13px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: rgba(233, 254, 252, 0.85);
    }

    .brand-sub {
      font-size: 11px;
      color: rgba(199, 245, 238, 0.7);
    }

    .status-pill {
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(0, 255, 159, 0.14);
      border: 1px solid rgba(0, 255, 159, 0.4);
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: rgba(199, 245, 238, 0.85);
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #00ff9f;
      box-shadow: 0 0 10px rgba(0, 255, 159, 0.9);
    }

    .title {
      margin-top: 8px;
      font-size: 18px;
      font-weight: 600;
      color: #f2fffd;
    }

    .subtitle {
      margin-top: 6px;
      font-size: 13px;
      color: rgba(199, 245, 238, 0.7);
    }

    .form {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: rgba(199, 245, 238, 0.65);
    }

    textarea {
      width: 100%;
      min-height: 80px;
      border-radius: 16px;
      border: 1px solid rgba(0, 199, 192, 0.3);
      background: radial-gradient(circle at 0 0, rgba(0, 199, 192, 0.04), #02040a);
      color: #e9fefc;
      padding: 10px 12px;
      resize: vertical;
      font-size: 13px;
      outline: none;
    }

    textarea::placeholder {
      color: rgba(119, 166, 160, 0.7);
    }

    .button-row {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .btn-main {
      width: 100%;
      border: none;
      border-radius: 999px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      background: radial-gradient(circle at 0 0, #00ff9f, #00c7c0 60%, #008b7f 100%);
      color: #02040a;
      box-shadow:
        0 0 18px rgba(0, 255, 159, 0.85),
        0 12px 30px rgba(0, 0, 0, 0.9);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transform-origin: center;
      transition:
        transform 0.14s ease-out,
        box-shadow 0.18s ease-out,
        filter 0.18s ease-out;
    }

    .btn-main:hover {
      transform: translateY(-1px) scale(1.01);
      filter: brightness(1.05);
      box-shadow:
        0 0 22px rgba(0, 255, 159, 1),
        0 16px 44px rgba(0, 0, 0, 1);
    }

    .btn-main:active {
      transform: translateY(1px) scale(0.99);
      box-shadow:
        0 0 10px rgba(0, 255, 159, 0.7),
        0 8px 20px rgba(0, 0, 0, 0.9);
    }

    .btn-main span.icon {
      font-size: 14px;
    }

    .meta {
      font-size: 11px;
      color: rgba(173, 222, 215, 0.7);
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
    }

    .log {
      margin-top: 10px;
      font-size: 11px;
      max-height: 96px;
      overflow: auto;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(2, 4, 10, 0.88);
      border: 1px solid rgba(0, 199, 192, 0.24);
      color: rgba(201, 244, 238, 0.9);
    }

    .log strong {
      color: #00ff9f;
    }

    .pill-badge {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(0, 199, 192, 0.16);
      border: 1px solid rgba(0, 199, 192, 0.4);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
  </style>
</head>
<body>
  <div class="vortex"></div>
  <div class="card">
    <div class="card-header">
      <div class="brand">
        <div class="brand-mark"></div>
        <div class="brand-text">
          <div class="brand-title">ASA CODE-HARMONIZER</div>
          <div class="brand-sub">Matrix-aligned repo orchestrator</div>
        </div>
      </div>
      <div class="status-pill">
        <span class="status-dot"></span>
        LIVE · WORKER
      </div>
    </div>

    <div class="title">One-tap harmonization trigger</div>
    <div class="subtitle">
      This panel sends a harmonization request to <code>ASA_FULL</code> via GitHub PR.
    </div>

    <div class="form">
      <div class="label-row">
        <span>Target paths (optional)</span>
        <span class="pill-badge">ASA MATRIX INPUT</span>
      </div>
      <textarea id="paths" placeholder="apps/**, packages/** or specific paths like apps/backend/src/index.ts"></textarea>

      <div class="label-row">
        <span>PR description (optional)</span>
        <span>Caller: ASA MATRIX UI</span>
      </div>
      <textarea id="description" placeholder="Describe what kind of harmonization you want (structure, style, etc.)"></textarea>
    </div>

    <div class="button-row">
      <button class="btn-main" id="runBtn">
        <span class="icon">⚡</span>
        <span>RUN ASA CODE-HARMONIZER</span>
      </button>
      <div class="meta">
        <span>Worker: <strong>asa-directory-editor</strong></span>
        <span id="statusText">Idle</span>
      </div>
    </div>

    <div class="log" id="logBox">
      <strong>LOG:</strong> Waiting for first harmonization request…
    </div>
  </div>

  <script>
    const runBtn = document.getElementById("runBtn");
    const logBox = document.getElementById("logBox");
    const statusText = document.getElementById("statusText");
    const pathsField = document.getElementById("paths");
    const descField = document.getElementById("description");

    function log(msg) {
      const now = new Date().toLocaleTimeString();
      logBox.innerHTML = "<strong>LOG:</strong> [" + now + "] " + msg;
    }

    runBtn.addEventListener("click", async () => {
      statusText.textContent = "Running…";
      runBtn.disabled = true;

      try {
        const rawPaths = pathsField.value.trim();
        const paths = rawPaths
          ? rawPaths.split(",").map((p) => p.trim()).filter(Boolean)
          : [];

        const body = {
          title: "ASA MATRIX – harmonization request",
          description: descField.value.trim() || "Triggered from ASA MATRIX vortex UI.",
          paths,
          caller: "ASA_MATRIX_INLINE_PANEL"
        };

        log("Sending harmonization request to /api/harmonize …");

        const res = await fetch("/api/harmonize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const json = await res.json();

        if (!json.ok) {
          log("Error: " + JSON.stringify(json));
          statusText.textContent = "Error";
        } else {
          const prUrl = json.pr_url || "(no url)";
          log("OK – PR created: <a href='" + prUrl + "' target='_blank' style='color:#00ff9f; text-decoration:none;'>" + prUrl + "</a>");
          statusText.textContent = "PR: #" + json.pr_number;
        }
      } catch (err) {
        log("Exception: " + String(err));
        statusText.textContent = "Exception";
      } finally {
        runBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}