import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.exitCode = 1;
} else {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("select 1");

    const response = await fetch("http://127.0.0.1:3000/");
    if (!response.ok) {
      throw new Error("Demo Web health request failed");
    }
  } catch {
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {
      process.exitCode = 1;
    });
  }
}
