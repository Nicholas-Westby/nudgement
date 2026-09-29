import { fakeFetch } from "./fake-fetch";

process.env.JEV_API_KEY = "offline-cli-test";
globalThis.fetch = fakeFetch(async () => new Response("Network disabled in CLI tests", { status: 400 }));
