import type {NextRequest} from "next/server";
import {lifecycleWorkspaceRoute} from "../server";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => lifecycleWorkspaceRoute(request, "experiment", false);
export const POST = (request: NextRequest) => lifecycleWorkspaceRoute(request, "experiment", true);
