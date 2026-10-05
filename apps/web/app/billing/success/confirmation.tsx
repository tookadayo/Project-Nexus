"use client";
import { useEffect, useState } from "react";
export function BillingConfirmation({locale}:{locale:"ja"|"en"}) {
  const [active,setActive]=useState(false);
  useEffect(()=>{
    let stopped=false,attempts=0,timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {
        const response=await fetch("/billing/status",{cache:"no-store"});
        if(response.ok){const state=await response.json();if(state.subscriptions?.some((s:{status:string;provider:string})=>s.provider==="STRIPE" && ["ACTIVE","CANCEL_AT_PERIOD_END"].includes(s.status))){if(!stopped)setActive(true);return;}}
      } catch { /* A redirect or transient failure never grants access. */ }
      if(!stopped && ++attempts<20)timer=setTimeout(poll,3000);
    }
    void poll();return ()=>{stopped=true;clearTimeout(timer);};
  },[]);
  return <p role="status">{active?(locale==="ja"?"ACTIVE — 契約を確認できました。":"ACTIVE — Subscription confirmed."):(locale==="ja"?"契約を確認しています。決済後の反映に少し時間がかかる場合があります。":"Confirming your subscription. Payment confirmation can take a moment.")}</p>;
}
