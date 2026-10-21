import type { NextRequest } from "next/server";
import { personalizationRoute } from "../../preferences/server";
export const runtime = "nodejs";
export const GET = (request: NextRequest) => personalizationRoute(request, "templates", false);
export const POST = (request: NextRequest) => personalizationRoute(request, "templates", true);
