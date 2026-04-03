export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { isin } = req.body;
    if (!isin) {
      return res.status(400).json({ error: "Missing ISIN" });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return res.status(500).json({ error: "Missing Supabase environment variables" });
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/resolve-isin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ isin }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: "Edge function failed", details: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
