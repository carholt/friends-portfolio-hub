export default async function handler(req, res) {
  try {
    const { isin } = req.body;

    if (!isin) {
      return res.status(400).json({ error: "Missing ISIN" });
    }

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/resolve-isin`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isin }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "Edge function failed", details: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
