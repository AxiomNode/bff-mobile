import { describe, expect, it } from "vitest";

import Fastify from "fastify";

import { monitoringRoutes } from "../app/routes/monitoring.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";

function createMetrics() {
  return new ServiceMetrics({
    SERVICE_NAME: "bff-mobile",
    SERVICE_PORT: 7010,
    ALLOWED_ORIGINS: "http://localhost:3000",
    QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
    WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    METRICS_LOG_BUFFER_SIZE: 2,
  });
}

describe("monitoring routes", () => {
  it("returns stats, bounded logs and prometheus metrics", async () => {
    const app = Fastify();
    const metrics = createMetrics();

    metrics.incrementInflight();
    metrics.recordIncomingRequest({
      method: "GET",
      route: "/v1/mobile/games/quiz/random",
      statusCode: 200,
      durationMs: 125,
      requestBytes: 64,
      responseBytes: 512,
    });
    metrics.recordIncomingRequest({
      method: "POST",
      route: "/v1/mobile/games/quiz/generate",
      statusCode: 503,
      durationMs: 6000,
      requestBytes: 128,
      responseBytes: 32,
    });
    metrics.decrementInflight();
    metrics.decrementInflight();

    metrics.recordLog("info", "first");
    metrics.recordLog("warn", "second", { attempt: 2 });
    metrics.recordLog("error", "third", { cause: "timeout" });

    await monitoringRoutes(app, metrics);

    const statsResponse = await app.inject({ method: "GET", url: "/monitor/stats" });
    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toMatchObject({
      service: "bff-mobile",
      traffic: {
        requestsReceivedTotal: 2,
        errorsTotal: 1,
        inflightRequests: 0,
        latencyCount: 2,
        requestBytesInTotal: 192,
        responseBytesOutTotal: 544,
      },
    });
    expect(statsResponse.json().requestsByRoute).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", route: "/v1/mobile/games/quiz/random", statusCode: 200, total: 1 }),
        expect.objectContaining({ method: "POST", route: "/v1/mobile/games/quiz/generate", statusCode: 503, total: 1 }),
      ]),
    );

    const logsResponse = await app.inject({ method: "GET", url: "/monitor/logs?limit=2" });
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json()).toMatchObject({
      service: "bff-mobile",
      total: 2,
      logs: [
        expect.objectContaining({ level: "warn", message: "second", context: { attempt: 2 } }),
        expect.objectContaining({ level: "error", message: "third", context: { cause: "timeout" } }),
      ],
    });

    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.headers["content-type"]).toContain("text/plain");
    expect(metricsResponse.body).toContain("bff_mobile_requests_received_total 2");
    expect(metricsResponse.body).toContain('requests_total{service="bff-mobile",method="POST",route="/v1/mobile/games/quiz/generate",status_code="503"} 1');
    expect(metricsResponse.body).toContain('errors_total{service="bff-mobile"} 1');
    expect(metricsResponse.body).toContain('latency_ms_bucket{service="bff-mobile",le="5000"} 1');
    expect(metricsResponse.body).toContain('latency_ms_bucket{service="bff-mobile",le="+Inf"} 2');

    await app.close();
  });

  it("rejects invalid log query parameters", async () => {
    const app = Fastify();
    await monitoringRoutes(app, createMetrics());

    const response = await app.inject({ method: "GET", url: "/monitor/logs?limit=0" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: "Invalid query parameters" });

    await app.close();
  });

  it("uses default log limit when the query is omitted", async () => {
    const app = Fastify();
    const metrics = createMetrics();
    metrics.recordLog("info", "only-log");

    await monitoringRoutes(app, metrics);

    const response = await app.inject({ method: "GET", url: "/monitor/logs" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "bff-mobile",
      total: 1,
      logs: [expect.objectContaining({ message: "only-log" })],
    });

    await app.close();
  });
});

describe("service metrics", () => {
  it("handles empty snapshots and missing internal counters safely", () => {
    const metrics = new ServiceMetrics({
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    const emptySnapshot = metrics.snapshot();
    expect(emptySnapshot.traffic.latencyAvgMs).toBe(0);

    const internalMetrics = metrics as unknown as {
      latencyBucketCounters: Map<number, number>;
    };
    internalMetrics.latencyBucketCounters.delete(50);

    metrics.recordIncomingRequest({
      method: "GET",
      route: "/v1/mobile/games/quiz/random",
      statusCode: 200,
      durationMs: 20,
      requestBytes: 8,
      responseBytes: 16,
    });
    internalMetrics.latencyBucketCounters.delete(100);

    const prometheus = metrics.toPrometheus();
    expect(prometheus).toContain('latency_ms_bucket{service="bff-mobile",le="50"} 1');
    expect(prometheus).toContain('latency_ms_bucket{service="bff-mobile",le="100"} 0');

    metrics.recordLog("info", "default-buffer");
    expect(metrics.recentLogs(0)).toHaveLength(1);
  });

  it("falls back to the default log buffer size when config omits it", () => {
    const metrics = new ServiceMetrics({
      SERVICE_NAME: "bff-mobile",
      SERVICE_PORT: 7010,
      ALLOWED_ORIGINS: "http://localhost:3000",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

    for (let index = 0; index < 1002; index += 1) {
      metrics.recordLog("info", `log-${index}`);
    }

    const logs = metrics.recentLogs(2000);
    expect(logs).toHaveLength(1000);
    expect(logs[0]?.message).toBe("log-2");
    expect(logs.at(-1)?.message).toBe("log-1001");
  });
});