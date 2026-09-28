import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

let env: TestEnv;

beforeEach(async () => {
  env = await freshEnv();
});

afterEach(() => {
  vi.doUnmock("qrcode");
  vi.resetModules();
});

function qr(workshopId: string) {
  return app.request(`/workshops/${workshopId}/qr.svg`, {}, env);
}

describe("GET /workshops/:id/qr.svg", () => {
  it("serves the QR code as an SVG image", async () => {
    const workshop = await seedWorkshop(env, {});

    const res = await qr(workshop.id);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  it("lets browsers cache the QR code for a day", async () => {
    const workshop = await seedWorkshop(env, {});

    const res = await qr(workshop.id);

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("returns 404 for an unknown workshop instead of a QR code", async () => {
    const res = await qr("3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");

    expect(res.status).toBe(404);
  });

  it("returns an svg", async () => {
    const workshop = await seedWorkshop(env, {});

    const body = await (await qr(workshop.id)).text();

    expect(body).toContain("<svg");
  });

  it("returns the generated svg", async () => {
    vi.resetModules();
    vi.doMock("qrcode", () => ({ default: { toString: vi.fn().mockResolvedValue("<svg>fake</svg>") } }));
    const { app: mockedApp } = await import("../src/app");
    const workshop = await seedWorkshop(env, {});

    const res = await mockedApp.request(`/workshops/${workshop.id}/qr.svg`, {}, env);

    expect(await res.text()).toBe("<svg>fake</svg>");
  });

  it("renders the QR code in under 50 milliseconds", async () => {
    const workshop = await seedWorkshop(env, {});

    const started = performance.now();
    await qr(workshop.id);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(50);
  });
});

describe("the booking link beside the QR code", () => {
  it("shows the full booking URL as text on the workshop page", async () => {
    const workshop = await seedWorkshop(env, {});

    const page = await app.request(`/workshops/${workshop.id}`, {}, env);

    expect(await page.text()).toContain(`https://claybankstudio.com/workshops/${workshop.id}/book`);
  });
});
