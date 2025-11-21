// ======================================================================
// ASA DIRECTORY EDITOR – HARMONIZER WORKER (FULL CLEAN VERSION)
// Cloudflare Workers runtime compatible
// No npm, no build, no bundler required
// ======================================================================

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // --------------------------------------------------------------
    // HEALTH ENDPOINT
    // --------------------------------------------------------------
    if (url.pathname === "/health") {
      return json({ ok: true, worker: "asa-directory-editor", status: "online" });
    }

    // --------------------------------------------------------------
    // ONLY POST ALLOWED FOR /harmonize
    // --------------------------------------------------------------
    if (url.pathname !== "/harmonize") {
      return json({ ok: false, error: "Unknown endpoint" }, 404);
    }

    if (req.method !== "POST") {
      return json({ ok: false, error: "Only POST allowed" }, 405);
    }

    try {
      const body = await req.json();
      const {
        paths = [],
        apply = false,
        owner = env.GITHUB_OWNER,
        repo = env.GITHUB_REPO,
        baseBranch = env.BASE_BRANCH || "main",
        note = "ASA MATRIX harmonizer run"
      } = body;

      // --------------------------------------------------------------
      // VALIDATION
      // --------------------------------------------------------------
      if (!env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN");
      if (!env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
      if (!owner || !repo) throw new Error("Missing repo owner/name");
      if (!paths.length) throw new Error("No paths provided");

      // --------------------------------------------------------------
      // STEP 1 — COLLECT FILES FROM GITHUB
      // --------------------------------------------------------------
      const collected = [];
      for (const p of paths) {
        await crawlGitHubDir(owner, repo, baseBranch, p, env.GITHUB_TOKEN, collected);
      }

      if (!collected.length) {
        return json({
          ok: false,
          error: "No files found in provided paths",
          paths
        }, 400);
      }

      console.log(`Collected ${collected.length} files`);

      // --------------------------------------------------------------
      // STEP 2 — CALL OPENAI HARMONIZER
      // --------------------------------------------------------------
      const harmonizerResult = await callOpenAIHarmonizer(env.OPENAI_API_KEY, {
        owner,
        repo,
        baseBranch,
        note,
        files: collected.slice(0, 12) // limit to avoid token overload
      });

      if (!harmonizerResult.files?.length) {
        return json({ ok: false, error: "Harmonizer returned no files" }, 500);
      }

      // IF PREVIEW → RETURN NEW FILES
      if (!apply) {
        return json({
          ok: true,
          mode: "preview",
          summary: harmonizerResult.summary || null,
          files: harmonizerResult.files
        });
      }

      // --------------------------------------------------------------
      // STEP 3 — APPLY MODE → Create branch + commit + PR
      // --------------------------------------------------------------
      const gh = ghClient(env.GITHUB_TOKEN);

      // Get base branch SHA
      const baseRef = await ghGet(gh,
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`
      );

      const baseSha = baseRef.object.sha;
      const newBranch = `asa-harmonizer-${Date.now()}`;

      // Create new branch
      await ghPost(gh,
        `https://api.github.com/repos/${owner}/${repo}/git/refs`,
        { ref: `refs/heads/${newBranch}`, sha: baseSha }
      );

      // Commit each file
      const updateResults = [];
      for (const file of harmonizerResult.files) {
        const encoded = base64encode(file.content);

        const putURL =
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}`;

        // Check if exists
        let existingSha = null;
        try {
          const existing = await ghGet(gh,
            `${putURL}?ref=${newBranch}`
          );
          existingSha = existing.sha;
        } catch (_) {}

        const payload = {
          message: `ASA Harmonizer Update: ${file.path}`,
          content: encoded,
          branch: newBranch
        };

        if (existingSha) payload.sha = existingSha;

        const res = await ghPut(gh, putURL, payload);

        updateResults.push({
          path: file.path,
          status: existingSha ? "updated" : "created",
          commit: res.commit?.sha || null
        });
      }

      // Create PR
      const pr = await ghPost(gh,
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          title: "ASA Harmonizer Automatic PR",
          head: newBranch,
          base: baseBranch,
          body: harmonizerResult.summary || note
        }
      );

      return json({
        ok: true,
        mode: "apply",
        branch: newBranch,
        prUrl: pr.html_url,
        prNumber: pr.number,
        changedFiles: updateResults
      });

    } catch (err) {
      console.error("ERROR:", err);
      return json({ ok: false, error: err.message || String(err) }, 500);
    }
  }
};

// ======================================================================
// GITHUB HELPERS
// ======================================================================

function ghClient(token) {
  return {
    async request(method, url, body) {
      const init = {
        method,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "ASA-HARMONIZER"
        }
      };
      if (body) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      const res = await fetch(url, init);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`GitHub ${method} failed: ${res.status} ${t}`);
      }
      return res.json();
  }};
}

function ghGet(client, url) { return client.request("GET", url); }
function ghPost(client, url, body) { return client.request("POST", url, body); }
function ghPut(client, url, body) { return client.request("PUT", url, body); }

// ======================================================================
// GITHUB FILE CRAWLING
// ======================================================================

async function crawlGitHubDir(owner, repo, branch, path, token, out) {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  });

  if (!res.ok) return;

  const data = await res.json();

  // Directory
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.type === "dir") {
        await crawlGitHubDir(owner, repo, branch, item.path, token, out);
      } else if (item.type === "file") {
        await pushFile(owner, repo, branch, item.path, token, out);
      }
    }
  }

  // Single file
  if (data.type === "file") {
    await pushFile(owner, repo, branch, data.path, token, out);
  }
}

async function pushFile(owner, repo, branch, path, token, out) {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  });

  if (!res.ok) return;

  const meta = await res.json();

  if (!meta.content) return;
  if (meta.size > 120000) return; // skip huge files

  const decoded = base64decode(meta.content);
  out.push({ path, content: decoded.slice(0, 7000) });
}

// ======================================================================
// OPENAI HARMONIZER CALL
// ======================================================================

async function callOpenAIHarmonizer(apiKey, payload) {
  const { owner, repo, baseBranch, note, files } = payload;

  const listText = files
    .map(f => `--- FILE: ${f.path}\n${f.content}`)
    .join("\n\n");

  const systemPrompt = `
You are ASA HARMONIZER ENGINE.
Unify, refactor, improve consistency without breaking code intent.
Return JSON strictly like:

{
  "summary": "short summary",
  "files": [
    { "path": "...", "content": "...", "rationale": "..." }
  ]
}
`;

  const userPrompt = `
Repo: ${owner}/${repo}
Branch: ${baseBranch}
Mission: ${note}

Files:
${listText}
`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI Error: ${res.status} ${t}`);
  }

  const json = await res.json();
  return JSON.parse(json.choices[0].message.content);
}

// ======================================================================
// HELPERS
// ======================================================================

function base64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64decode(str) {
  return decodeURIComponent(escape(atob(str)));
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
