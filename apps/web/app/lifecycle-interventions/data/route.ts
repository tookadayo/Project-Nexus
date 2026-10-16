import type {NextRequest} from "next/server";
import {lifecycleWorkspaceRoute} from "../../experiments/server";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => lifecycleWorkspaceRoute(request, "intervention", false);
export const POST = (request: NextRequest) => lifecycleWorkspaceRoute(request, "intervention", true);
