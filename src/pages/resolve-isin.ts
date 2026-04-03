export default async function handler(req, res) {
  const { isin } = req.body

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/resolve-isin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ isin })
  })

  const data = await response.json()
  res.status(200).json(data)
}
