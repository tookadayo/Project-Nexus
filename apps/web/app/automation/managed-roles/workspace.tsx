"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ManagedRolePolicyDto, ManagedRolePolicySpec } from "../../../../../packages/automation/src/managed-roles";
import { ConfirmationDialog } from "../../confirmation-dialog";
import { automationClient } from "../client";
import { ManagedRoleRequestError, managedRoleClient } from "./client";
import "./workspace.css";
type Draft = { id: string; base: ManagedRolePolicyDto | null; name: string; roleId: string; operation: "GRANT" | "REVOKE" };
export function ManagedRoleWorkspace({ guildId, locale, readOnly }: { guildId: string; locale: "ja" | "en"; readOnly: boolean }) {
  const t = (ja: string, en: string) => locale === "ja" ? ja : en;
  const client = useMemo(() => managedRoleClient(guildId), [guildId]), native = useMemo(() => automationClient("/api/automation", guildId), [guildId]);
  const [items, setItems] = useState<ManagedRolePolicyDto[]>([]), [incompatible, setIncompatible] = useState<string[]>([]),
    [roles, setRoles] = useState<{ id: string; name: string }[]>([]), [roleState, setRoleState] = useState<"loading" | "ready" | "unavailable">("loading"),
    [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false),
    [problem, setProblem] = useState(""), [notice, setNotice] = useState(""), [confirm, setConfirm] = useState<"save" | "delete" | "discard" | "enable" | "run" | null>(null),
    [pending, setPending] = useState<{ id: string; requestId: string; kind: "SAVE" | "DELETE" | "ENABLE" | "START" } | null>(null),
    [checks, setChecks] = useState<{ kind: string; valid: boolean; complete: boolean; status?: string; codes: string[] }[]>([]),
    [memberId, setMemberId] = useState(""),[targetMemberId,setTargetMemberId]=useState(""), [mockOutcome, setMockOutcome] = useState<"SUCCEEDED" | "FAILED" | "NOT_STARTED" | "UNKNOWN">("SUCCEEDED"),
    [history, setHistory] = useState<Awaited<ReturnType<typeof client.history>>["items"]>([]);
  const flight = useRef(false), epoch = useRef(0);
  const dirty = Boolean(draft && (!draft.base || draft.name !== draft.base.policy.name || draft.roleId !== draft.base.policy.roleId || draft.operation !== draft.base.policy.operation));
  const errorText = (error: unknown) => error instanceof ManagedRoleRequestError && error.status === 403 ? t("現在の権限ではこの設定を変更できません。", "Your current permissions do not allow changing this policy.")
    : error instanceof ManagedRoleRequestError && (error.status === 409 || error.status === 412) ? t("設定の版や安全状態が変わりました。最新の設定を読み直してください。", "The revision or safety state changed. Reload the latest policy.")
      : t("情報を確認できませんでした。変更結果が未確認の場合は記録を照合してください。", "The information could not be verified. Check the recorded result if the change is unconfirmed.");
  const load = async () => {
    const [policies, applied] = await Promise.all([client.list(), client.history()]);
    setItems(policies.items); setIncompatible(policies.incompatible.map(item => item.id));
    setHistory(applied.items.filter(item => /^managed_role_[a-f0-9]{32}$/.test(item.flowId))); setLoaded(true);
  };
  useEffect(() => {
    const current = ++epoch.current; flight.current = true; setBusy(true); setProblem(""); setDraft(null); setPending(null); setLoaded(false);
    Promise.all([client.list(), client.history(), native.targets("RoleRef").catch(() => null)]).then(([policies, applied, choices]) => {
      if (current !== epoch.current) return;
      setItems(policies.items); setIncompatible(policies.incompatible.map(item => item.id));
      setHistory(applied.items.filter(item => /^managed_role_[a-f0-9]{32}$/.test(item.flowId))); setLoaded(true);
      setRoles(choices?.items ?? []); setRoleState(choices?.state === "AVAILABLE" ? "ready" : "unavailable");
    }).catch(error => { if (current === epoch.current) setProblem(errorText(error)); })
      .finally(() => { if (current === epoch.current) { flight.current = false; setBusy(false); } });
    return () => { ++epoch.current; };
  // Locale/guild changes remount this workspace. Error text follows that scope.
  }, [client, native]);
  useEffect(() => { const prevent = (event: BeforeUnloadEvent) => { if (dirty || pending) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent); }, [dirty, pending]);
  const refresh = async () => {
    if (flight.current || pending) return; flight.current = true; setBusy(true); setProblem(""); const at = epoch.current;
    try { await load(); if (at === epoch.current) { setDraft(null); setChecks([]); setNotice(t("最新の設定を読み込みました。", "Latest policies loaded.")); } }
    catch (error) { if (at === epoch.current) setProblem(errorText(error)); } finally { if (at === epoch.current) { flight.current = false; setBusy(false); } }
  };
  const choose = (item: ManagedRolePolicyDto | null) => {
    if (flight.current || pending || dirty) return;
    setTargetMemberId('');
    setDraft(item ? { id: item.id, base: item, ...item.policy } : { id: "managed_role_" + crypto.randomUUID().replaceAll("-", ""), base: null, name: "", roleId: "", operation: "GRANT" }); setChecks([]); setProblem(""); setNotice("");
  };
  const mutate = async (kind: "save" | "delete") => {
    if (flight.current || pending || readOnly || !draft) return;
    const current = draft, at = epoch.current, requestId = crypto.randomUUID();
    const base = { expectedRevision: current.base?.policyVersion ?? 0, expectedActiveRevision: current.base?.activeRevision ?? null, expectedGeneration: current.base?.generation ?? 0, requestId };
    flight.current = true; setBusy(true); setProblem(""); setConfirm(null);
    let committed = false;
    try {
      if (kind === "save") await client.save(current.id, { ...base, policy: { name: current.name.trim(), roleId: current.roleId, operation: current.operation } });
      else await client.remove(current.id, base);
      committed = true;
      const saved = kind === "save" ? await client.detail(current.id) : null;
      if (at !== epoch.current) return;
      setDraft(saved ? { id: saved.id, base: saved, ...saved.policy } : null); setChecks([]); await load();
      setNotice(t(kind === "save" ? "新しい Draft を保存しました。有効中の版は変更していません。" : "設定を削除し、既存の停止・取消処理を要求しました。", kind === "save" ? "A new draft was saved. The enabled revision is unchanged." : "The policy was deleted using the existing stop and cancellation workflow."));
    } catch (error) { if (at === epoch.current) { setProblem(errorText(error)); if (committed || error instanceof ManagedRoleRequestError && error.uncertain) setPending({ id: current.id, requestId, kind: kind === "save" ? "SAVE" : "DELETE" }); } }
    finally { if (at === epoch.current) { flight.current = false; setBusy(false); } }
  };
  const reconcile = async () => {
    if (!pending || flight.current) return; const current = pending, at = epoch.current; flight.current = true; setBusy(true); setProblem("");
    try { const receipt = await client.lookup(current.requestId); if (receipt.flowId !== current.id || receipt.kind !== current.kind) throw new ManagedRoleRequestError("REQUEST_SCOPE_CHANGED", 409);
      const saved = current.kind !== "DELETE" ? await client.detail(current.id) : null;
      if (at !== epoch.current) return; setDraft(saved ? { id: saved.id, base: saved, ...saved.policy } : null); await load(); setPending(null); setChecks([]); setNotice(t("保存済みの結果を照合しました。変更要求は再送していません。", "The recorded result was checked. The mutation was not resent."));
    } catch (error) { if (at === epoch.current) setProblem(errorText(error)); } finally { if (at === epoch.current) { flight.current = false; setBusy(false); } }
  };
  const check = async (kind: "VALIDATE" | "TEST" | "IMPACT") => {
    if (!draft?.base || dirty || flight.current || pending || readOnly) return;
    if (kind === "TEST" && !/^\d{17,20}$/.test(memberId)) { setProblem(t("模擬入力のメンバー ID を指定してください。", "Enter the member ID for the simulation input.")); return; }
    const at = epoch.current; flight.current = true; setBusy(true); setProblem("");
    try { const result = await client.check(draft.id, { revision: draft.base.policyVersion, kind, ...(kind === "TEST" ? { simulation: { memberId, outcome: mockOutcome } } : {}) });
      if (at === epoch.current) {
        setChecks(previous => [...previous.filter(item => item.kind !== kind), { kind, valid: result.valid, complete: result.complete, status: result.status, codes: result.issues.map(issue => issue.code) }]);
        const saved=await client.detail(draft.id);if(at===epoch.current)setDraft({id:saved.id,base:saved,...saved.policy});
      }
    } catch (error) { if (at === epoch.current) setProblem(errorText(error)); } finally { if (at === epoch.current) { flight.current = false; setBusy(false); } }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!busy && !pending && draft && !readOnly) setConfirm("save"); };
  const nativeMutate=async(kind:'enable'|'run')=>{
    if(!draft?.base||dirty||readOnly||pending||flight.current)return;
    const current=draft.base;if(kind==='enable'?!current.activationAvailable:!current.directMutationAvailable)return;
    if(kind==='run'&&!/^\d{17,20}$/.test(targetMemberId)){setProblem(t('操作対象のメンバー ID を入力してください。','Enter the target member ID.'));return;}
    const at=epoch.current,requestId=crypto.randomUUID();let sent=false,committed=false;
    flight.current=true;setBusy(true);setProblem('');setConfirm(null);
    try{
      if(kind==='enable'){
        const input={expectedRevision:current.policyVersion,expectedActiveRevision:current.activeRevision,expectedGeneration:current.generation,semanticHash:current.semanticHash,requestId};
        const prepared=await client.prepareEnable(current.id,input);sent=true;
        await client.enable(current.id,{...input,requestProof:prepared.requestProof});
      }else{
        const input={policyRevision:current.policyVersion,semanticHash:current.semanticHash,memberId:targetMemberId,requestId};
        const prepared=await client.prepareRun(current.id,input);
        if(!prepared.directMutationAvailable||!prepared.requestProof)throw new ManagedRoleRequestError(prepared.reasonCode??'MANAGED_ROLE_G3_NOT_READY',409);
        sent=true;await client.run(current.id,{...input,requestProof:prepared.requestProof});
      }
      committed=true;const saved=await client.detail(current.id);if(at!==epoch.current)return;
      setDraft({id:saved.id,base:saved,...saved.policy});await load();
      setNotice(t(kind==='enable'?'確認済みの版を有効にしました。':'既存 Run に受け付けました。ロール操作は通常の承認と実行前確認に進みます。',kind==='enable'?'The reviewed revision was enabled.':'An existing Automation Run was accepted. Role changes follow the ordinary approval and execution checks.'));
    }catch(error){if(at===epoch.current){setProblem(errorText(error));if(committed||sent&&(error instanceof ManagedRoleRequestError&&error.uncertain||!(error instanceof ManagedRoleRequestError)))setPending({id:current.id,requestId,kind:kind==='enable'?'ENABLE':'START'});}}
    finally{if(at===epoch.current){flight.current=false;setBusy(false);}}
  };
  const nativeActions=draft?.base&&<section><h3>{t('有効化と実行','Enable and run')}</h3>
    <p>{t('現在の認可と安全状態を送信時に再確認します。結果が不明な場合は再送せず、記録を照合します。','Current authorization and safety are checked again at submission. An unconfirmed result is reconciled without resending.')}</p>
    {draft.base.reasonCode&&<p role="status">{draft.base.reasonCode==='MANAGED_ROLE_NATIVE_REVIEW_REQUIRED'?t('保存した版の検証・模擬テスト・影響確認を完了してください。','Complete validation, simulation and impact review for the saved revision.')
      :draft.base.reasonCode==='MANAGED_ROLE_RESULT_UNRESOLVED'?t('結果が未確認の処理があります。記録を照合するまで新しい操作は開始できません。','An operation has an unconfirmed result. Reconcile its record before starting another operation.')
      :t('現在の権限と安全な実行条件を確認できるまで、有効化と操作の開始は利用できません。','Enabling and starting operations are unavailable until current authorization and execution safety can be verified.')}</p>}
    <button disabled={busy||Boolean(pending)||dirty||readOnly||!draft.base.activationAvailable} onClick={()=>setConfirm('enable')}>{t('確認済みの版を有効化','Enable the reviewed revision')}</button>
    <label>{t('実際の操作対象のメンバー ID','Member ID for the actual operation')}<input inputMode="numeric" pattern="[0-9]{17,20}" value={targetMemberId} disabled={busy||Boolean(pending)||readOnly} onChange={event=>setTargetMemberId(event.target.value)}/></label>
    <button disabled={busy||Boolean(pending)||dirty||readOnly||!draft.base.directMutationAvailable||!/^\d{17,20}$/.test(targetMemberId)} onClick={()=>setConfirm('run')}>{t('この設定で操作を開始','Start the operation with this policy')}</button>
    {(confirm==='enable'||confirm==='run')&&<ConfirmationDialog label={t('操作の確認','Confirm operation')} busy={busy} onCancel={()=>setConfirm(null)}><h2>{t(confirm==='enable'?'この版を有効にしますか？':'このメンバーへの操作を開始しますか？',confirm==='enable'?'Enable this revision?':'Start the operation for this member?')}</h2><p>{guildId} / {draft.base.policy.name} / {draft.base.policy.roleId} / {draft.base.policy.operation} / {draft.base.policyVersion}{confirm==='run'?' / '+targetMemberId:''}</p><button disabled={busy} onClick={()=>setConfirm(null)}>{t('戻る','Back')}</button><button disabled={busy||Boolean(pending)} onClick={()=>void nativeMutate(confirm==="enable"?"enable":"run")}>{t(confirm==='enable'?'有効化':'Run を開始',confirm==='enable'?'Enable':'Start Run')}</button></ConfirmationDialog>}
  </section>;
  return <main className="managed-role-workspace" aria-busy={busy}><nav><a href="/automation">{t("オートメーションへ戻る", "Back to automation")}</a></nav>
    <h1>{t("管理対象ロールの設定", "Managed role policies")}</h1><p>{t("1つの設定に、対象ロール1つと付与または解除の操作を保存します。変更は通常の Flow の新しい Draft として保存されます。", "Each policy fixes one role and a grant or removal operation. Changes are saved as a new draft of an ordinary Flow.")}</p>
    {readOnly && <p role="status">{t("現在の権限では設定の作成・変更はできません。", "Your current permissions do not allow creating or changing policies.")}</p>}
    <p role="status">{t("有効化・直接の付与・解除は、安全状態と稼働条件の確認が未完了のため利用できません。AI からの直接実行もありません。", "Activation and direct grants or removals are unavailable until current safety and operating conditions are verified. AI cannot execute role changes directly.")}</p>
    {problem && <p role="alert">{problem}</p>}{notice && <p role="status">{notice}</p>}
    {pending && <section role="status"><p>{t("変更結果が未確認です。新しい変更と再送を止めています。", "The mutation result is unconfirmed. New changes and resending are stopped.")}</p><button disabled={busy} onClick={() => void reconcile()}>{t("記録済みの結果を照合", "Check recorded result")}</button></section>}
    <div className="managed-role-toolbar"><button disabled={busy || Boolean(pending) || dirty || readOnly} onClick={() => choose(null)}>{t("設定を作成", "Create policy")}</button><button disabled={busy || Boolean(pending) || dirty} onClick={() => void refresh()}>{t("最新情報を読み込む", "Reload")}</button></div>
    {loaded && items.length === 0 && <p>{t("保存済みのロール設定はありません。", "There are no saved role policies.")}</p>}
    <ul>{items.map(item => <li key={item.id}><button disabled={busy || Boolean(pending) || dirty} onClick={() => choose(item)}>{item.policy.name}</button> — {item.policy.operation === "GRANT" ? t("付与", "Grant") : t("解除", "Remove")} / {item.policy.roleId} / Draft {item.policyVersion} / {t("有効中", "Enabled")} {item.activeRevision ?? t("なし", "none")}</li>)}</ul>
    {incompatible.length > 0 && <section><h2>{t("通常の Flow で確認が必要な設定", "Policies requiring the ordinary Flow editor")}</h2><p>{t("専用形式以外の変更があるため、この画面では上書きしません。", "These definitions contain changes outside the dedicated policy shape and cannot be overwritten here.")}</p>{incompatible.map(id => <p key={id}><a href={`/automation?flow=${encodeURIComponent(id)}`}>{id}</a></p>)}</section>}
    {draft && <section><h2>{draft.base ? t("設定を編集", "Edit policy") : t("新しい設定", "New policy")}</h2><form key={draft.id} onSubmit={submit}><fieldset disabled={busy || Boolean(pending) || readOnly}>
      <label>{t("名前", "Name")}<input required maxLength={160} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
      <label>{t("対象ロール", "Role")}<select required disabled={roleState !== "ready"} value={draft.roleId} onChange={event => setDraft({ ...draft, roleId: event.target.value })}><option value="">{t("ロールを選ぶ", "Select a role")}</option>{draft.roleId && !roles.some(role => role.id === draft.roleId) && <option value={draft.roleId}>{t("現在は確認できないロール", "Currently unverified role")} ({draft.roleId})</option>}{roles.map(role => <option key={role.id} value={role.id}>{role.name} ({role.id})</option>)}</select></label>
      {roleState === "unavailable" && <p role="status">{t("現在のロール一覧を取得できません。作成・保存を止めています。", "Current roles could not be retrieved. Creating or saving is stopped.")}</p>}
      <label>{t("操作", "Operation")}<select value={draft.operation} onChange={event => setDraft({ ...draft, operation: event.target.value as ManagedRolePolicySpec["operation"] })}><option value="GRANT">{t("付与", "Grant")}</option><option value="REVOKE">{t("解除", "Remove")}</option></select></label>
      <p>{t("保護対象や強い権限を持つロール、Bot の到達可能範囲は、既存の承認・実行時チェックで確認されます。", "Protected or privileged roles and the bot hierarchy are checked by the existing approval and execution checks.")}</p>
      {draft.base?.activePolicy && <p>{t("現在有効な設定", "Currently enabled policy")}: {draft.base.activePolicy.roleId} / {draft.base.activePolicy.operation} / {draft.base.activePolicy.revision}</p>}
      <button disabled={!dirty || roleState !== "ready" || !draft.roleId}>{t("新しい Draft を保存", "Save a new draft")}</button>
      {draft.base && <button type="button" disabled={dirty} onClick={() => setConfirm("delete")}>{t("設定を削除", "Delete policy")}</button>}
      <button type="button" onClick={() => dirty ? setConfirm("discard") : setDraft(null)}>{t("取消・閉じる", "Cancel / close")}</button>
    </fieldset></form>
    {draft.base && <section><h3>{t("保存した版を確認", "Review the saved revision")}</h3><p>{t("模擬入力と結果を指定するテストは、Discord の状態を変更しません。", "Tests use the specified mock input and result without changing Discord.")}</p>
      <label>{t("模擬メンバー ID", "Mock member ID")}<input inputMode="numeric" pattern="[0-9]{17,20}" value={memberId} disabled={busy} onChange={event => setMemberId(event.target.value)}/></label>
      <label>{t("模擬結果", "Mock result")}<select value={mockOutcome} disabled={busy} onChange={event => setMockOutcome(event.target.value as typeof mockOutcome)}>{["SUCCEEDED", "FAILED", "NOT_STARTED", "UNKNOWN"].map(value => <option key={value}>{value}</option>)}</select></label>
      {(["VALIDATE", "TEST", "IMPACT"] as const).map((kind, index) => <button key={kind} disabled={busy || Boolean(pending) || dirty || readOnly} onClick={() => void check(kind)}>{[t("検証", "Validate"), t("模擬テスト", "Simulate"), t("影響を確認", "Review impact")][index]}</button>)}
      <ul>{checks.map(item => <li key={item.kind}>{item.kind}: {item.status ?? (item.valid && item.complete ? t("確認済み", "Checked") : t("要確認", "Needs review"))}{item.codes.length > 0 ? " / " + item.codes.join(", ") : ""}</li>)}</ul>
      {nativeActions}
      <a href={`/automation?flow=${encodeURIComponent(draft.id)}`}>{t("通常の Flow で版と承認を確認", "Review revisions and approval in the Flow workspace")}</a>
    </section>}</section>}
    <section><h2>{t("既存 Run のロール操作履歴", "Role operation history from existing Runs")}</h2>{history.length ? <ul>{history.map((item, index) => <li key={item.runId + index}><a href={`/automation?flow=${encodeURIComponent(item.flowId)}&run=${encodeURIComponent(item.runId)}`}>{item.flowId} / {item.revision}</a> — {item.operation === "discord.addRole" ? t("付与", "Grant") : t("解除", "Remove")} / {item.state === "UNKNOWN" ? t("結果不明・再送禁止", "Result unknown; no resend") : item.state} / <time dateTime={item.startedAt}>{item.startedAt}</time></li>)}</ul> : <p>{t("確認できる操作履歴はありません。", "No role operation history is available.")}</p>}</section>
    {confirm && confirm!=="enable" && confirm!=="run" && draft && <ConfirmationDialog label={t("操作の確認", "Confirm operation")} busy={busy} onCancel={() => setConfirm(null)}><h2>{t(confirm === "save" ? "新しい設定版を保存しますか？" : confirm === "delete" ? "この設定を削除しますか？" : "未保存の編集を取り消しますか？", confirm === "save" ? "Save a new policy revision?" : confirm === "delete" ? "Delete this policy?" : "Discard unsaved edits?")}</h2><p>{draft.name || draft.id} / {draft.roleId} / {draft.operation}</p><p>{t("サーバー", "Server")}: {guildId} / Draft {draft.base?.policyVersion ?? 0}</p>
      <button disabled={busy} onClick={() => setConfirm(null)}>{t("戻る", "Back")}</button><button disabled={busy || Boolean(pending)} onClick={() => { if (confirm === "discard") { setDraft(null); setConfirm(null); setChecks([]); } else if (confirm === "save" || confirm === "delete") void mutate(confirm); }}>{t(confirm === "save" ? "Draft を保存" : confirm === "delete" ? "削除" : "編集を取り消す", confirm === "save" ? "Save draft" : confirm === "delete" ? "Delete" : "Discard edits")}</button></ConfirmationDialog>}
  </main>;
}
