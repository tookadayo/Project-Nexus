import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newsContents,
  newsHref,
  newsQuery,
  newsTimestamp,
} from "../../apps/web/app/news/news-model";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  connection: vi.fn(),
  destroy: vi.fn(),
  publicList: vi.fn(),
  publicDetail: vi.fn(),
}));
vi.mock("../../apps/web/node_modules/next/server", () => ({
  connection: mocks.connection,
}));
vi.mock("../../packages/db/src/index", () => ({ connect: mocks.connect }));
vi.mock("../../packages/operations/src/publication", () => ({
  OfficialPublications: class {
    publicList = mocks.publicList;
    publicDetail = mocks.publicDetail;
  },
}));
import {
  publicNewsDetail,
  publicNewsList,
} from "../../apps/web/app/publication-data";

describe("official announcement navigation", () => {
  it("preserves heading hierarchy and anchor text in the article contents", () => {
    const headings = [
      { id: "a", level: 2, text: "Article A" },
      { id: "a-1", level: 3, text: "Part one" },
      { id: "a-1-i", level: 5, text: "Detail" },
      { id: "a-2", level: 3, text: "Part two" },
      { id: "b", level: 2, text: "Article B" },
    ];
    const original = structuredClone(headings);
    expect(newsContents(headings)).toEqual([
      {
        ...headings[0],
        children: [
          { ...headings[1], children: [{ ...headings[2], children: [] }] },
          { ...headings[3], children: [] },
        ],
      },
      { ...headings[4], children: [] },
    ]);
    expect(headings).toEqual(original);
  });
  it("preserves valid filters and pagination without accepting arbitrary query values", () => {
    expect(newsQuery({ category: "INCIDENT", page: "2" })).toEqual({
      category: "INCIDENT",
      page: 2,
    });
    for (const page of [
      "0",
      "-1",
      "1.5",
      "1e3",
      "100001",
      "9999999999",
      ["2", "3"],
    ]) {
      expect(newsQuery({ page }).page).toBe(1);
    }
    expect(
      newsQuery({ category: ["UPDATE", "INCIDENT"] }).category,
    ).toBeUndefined();
    expect(newsQuery({ category: "DRAFT" }).category).toBeUndefined();
  });
  it("keeps list context in detail and back links, while encoding every article id", () => {
    expect(newsHref({ category: "POLICY", page: 3 })).toBe(
      "/news?category=POLICY&page=3",
    );
    expect(newsHref({ category: "POLICY", page: 3 }, "article")).toBe(
      "/news/article?category=POLICY&page=3",
    );
    expect(newsHref({ page: 1 })).toBe("/news");
    expect(newsHref({ page: 1 }, "../?draft=1")).toBe(
      "/news/..%2F%3Fdraft%3D1",
    );
  });
  it("shows a fixed UTC timestamp without using the browser's timezone or inventing a date", () => {
    expect(newsTimestamp("2026-10-10T02:30:00+09:00")).toBe(
      "2026-10-09 17:30 UTC",
    );
    expect(newsTimestamp("invalid")).toBeNull();
  });
});

describe("fresh public announcement reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue(undefined);
    mocks.connect.mockReturnValue({ destroy: mocks.destroy });
    mocks.destroy.mockResolvedValue(undefined);
    vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/local_only");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("distinguishes an unconfigured database from an available empty result", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await publicNewsList({ locale: "en" })).toEqual({
      state: "unavailable",
    });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.publicList).not.toHaveBeenCalled();
    expect(mocks.connection).toHaveBeenCalledOnce();
  });
  it("does not reuse a published body after a fresh read reports withdrawal", async () => {
    mocks.publicDetail
      .mockResolvedValueOnce({ id: "synthetic", body: "Published A" })
      .mockResolvedValueOnce(null);
    expect(await publicNewsDetail("synthetic", "en")).toEqual({
      state: "ready",
      data: { id: "synthetic", body: "Published A" },
    });
    expect(await publicNewsDetail("synthetic", "en")).toEqual({
      state: "ready",
      data: null,
    });
    expect(mocks.publicDetail.mock.calls).toEqual([
      ["synthetic", "en"],
      ["synthetic", "en"],
    ]);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
    expect(mocks.connection).toHaveBeenCalledTimes(2);
  });
  it("requests only the public list and closes its connection", async () => {
    const data = {
      items: [],
      page: 2,
      pageSize: 20,
      total: 21,
      hasNext: false,
    };
    mocks.publicList.mockResolvedValue(data);
    expect(
      await publicNewsList({ category: "INCIDENT", page: 2, locale: "en" }),
    ).toEqual({ state: "ready", data });
    expect(mocks.publicList).toHaveBeenCalledWith({
      category: "INCIDENT",
      page: 2,
      locale: "en",
    });
    expect(mocks.publicDetail).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("fails without returning database diagnostics, cached bodies, or a false zero", async () => {
    mocks.publicList.mockRejectedValue(
      new Error("synthetic private database diagnostic"),
    );
    expect(await publicNewsList({})).toEqual({ state: "unavailable" });
    expect(mocks.destroy).toHaveBeenCalledOnce();
    mocks.connect.mockImplementationOnce(() => {
      throw new Error("synthetic private connection diagnostic");
    });
    expect(await publicNewsDetail("synthetic", "ja")).toEqual({
      state: "unavailable",
    });
  });
});
