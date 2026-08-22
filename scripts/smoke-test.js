const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:8080";

async function main() {
  const results = [];
  let createdId;

  async function check(label, fn) {
    try {
      await fn();
      results.push({ label, ok: true });
    } catch (err) {
      results.push({ label, ok: false, error: err.message });
    }
  }

  await check("GET / responds with welcome message", async () => {
    const res = await fetch(`${BASE_URL}/`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (!body.message) throw new Error(" SEM CAMPO DE MENSAGEM ");
  });

  await check("POST /api/tutorials creates a tutorial", async () => {
    const res = await fetch(`${BASE_URL}/api/tutorials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Smoke test",
        description: "created by scripts/smoke-test.js",
        published: true
      })
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (!body.id) throw new Error(" SEM ID NO RESPONSE ");
    createdId = body.id;
  });

  await check("GET /api/tutorials/:id retrieves the created tutorial", async () => {
    const res = await fetch(`${BASE_URL}/api/tutorials/${createdId}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  });

  await check("PUT /api/tutorials/:id updates the tutorial", async () => {
    const res = await fetch(`${BASE_URL}/api/tutorials/${createdId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: false })
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  });

  await check("DELETE /api/tutorials/:id removes the tutorial", async () => {
    const res = await fetch(`${BASE_URL}/api/tutorials/${createdId}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  });

  for (const r of results) {
    console.log(`${r.ok ? "PASSOU" : "FALHOU"} - ${r.label}${r.error ? ` (${r.error})` : ""}`);
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} - Teste Falhou.`);
    process.exit(1);
  }

  console.log(`\nTODOS OS ${results.length} TESTES PASSARAM!.`);
}

main();
