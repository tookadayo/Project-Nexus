import type { NextRequest } from "next/server";
import { personalizationRoute } from "../server";
export const runtime = "nodejs";
export const GET = (request: NextRequest) => personalizationRoute(request, "preferences", false);
export const POST = (request: NextRequest) => personalizationRoute(request, "preferences", true);
