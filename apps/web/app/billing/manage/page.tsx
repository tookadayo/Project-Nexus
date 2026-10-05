import { BillingView } from "../view";
export const dynamic = "force-dynamic";
export default async function ManageBilling({searchParams}:{searchParams:Promise<{offering?:string}>}) {
  const {offering}=await searchParams;
  return <BillingView section="manage" selectedOffering={offering} />;
}
