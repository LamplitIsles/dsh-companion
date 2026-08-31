import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { SettingsScope, SettingsScopeSnapshot } from "@deepseek-ai/dsh-client-runtime/client";
import { readAvatar, relationshipControlsWritable, settingsPayload, type ClientSettings } from "./settings.js";
import styles from "./CompanionSettingsCard.module.css";

export interface CompanionSettingsCardProps {
  scope: SettingsScope<ClientSettings>;
  currentAffinity?: () => Promise<number | undefined>;
  resetAffinity?: () => Promise<void>;
  setAffinity?: (value: number) => Promise<void>;
  clearSignature?: () => Promise<void>;
}

export function CompanionSettingsCard({ scope, currentAffinity, resetAffinity, setAffinity, clearSignature }: CompanionSettingsCardProps): JSX.Element | null {
  const [snapshot, setSnapshot] = useState<SettingsScopeSnapshot<ClientSettings>>(() => scope.getSnapshot());
  const empty: ClientSettings = { workspaceId: "", companionName: "Companion", userName: "你", preferredAddress: "你", defaultAffinity: 50 };
  const [draft, setDraft] = useState<ClientSettings>(() => snapshot.value ?? empty);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [affinity, setCurrentAffinity] = useState<number | undefined>();
  const [affinityDraft, setAffinityDraft] = useState("50");
  useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
  useEffect(() => { if (currentAffinity) void currentAffinity().then(setCurrentAffinity).catch(() => undefined); }, [currentAffinity]);
  useEffect(() => { if (affinity !== undefined) setAffinityDraft(String(affinity)); }, [affinity]);
  const accepted = snapshot.value ?? empty;
  const dirty = useMemo(() => JSON.stringify(settingsPayload(draft)) !== JSON.stringify(settingsPayload(accepted)), [draft, accepted]);
  // External commits may replace the accepted snapshot, but a rejected or
  // conflicted save must leave the user's staged draft intact for correction.
  useEffect(() => { if (!saving && !error && !dirty && snapshot.value) setDraft(snapshot.value); }, [snapshot.value, saving, error, dirty]);
  if (snapshot.status === "loading" || snapshot.status === "unavailable") return null;
  const readOnly = !snapshot.writable;
  const controlsWritable = relationshipControlsWritable(readOnly, saving);
  const set = <K extends keyof ClientSettings>(key: K, value: ClientSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function save(): Promise<void> {
    if (readOnly || !dirty) return;
    setSaving(true); setError(""); setStatus("正在保存…");
    try {
      const payload = settingsPayload(draft);
      for (const [key, value] of Object.entries(payload)) await scope.set(key, value);
      setStatus("已保存");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请检查设置后重试。"); setStatus("未保存"); }
    finally { setSaving(false); }
  }
  function discard(): void { setDraft(accepted); setError(""); setStatus("已撤销未保存的更改"); }
  async function correctAffinity(): Promise<void> {
    const value = Number(affinityDraft);
    if (!Number.isSafeInteger(value) || value < 0 || value > 100) { setError("亲近度必须是 0 到 100 的整数。"); return; }
    try { await setAffinity?.(value); setCurrentAffinity(value); setStatus("亲近度已更新"); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "亲近度更新失败。"); }
  }
  async function avatar(kind: "companionAvatar" | "userAvatar", event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try { set(kind, await readAvatar(file)); setStatus("头像已准备，点击保存后生效"); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "头像无效。"); }
  }
  return <li className={`${styles.card} ${open ? styles.open : ""}`}>
    <button type="button" className={styles.header} aria-expanded={open} aria-controls="dsh-companion-settings-body" aria-label={`${open ? "收起" : "展开"}：Companion 日常聊天`} onClick={() => setOpen((value) => !value)}>
      <span className={styles.headText}><span className={styles.title}>Companion 日常聊天</span><span className={styles.intro}>一个 Workspace、两个身份和一段持续的关系</span></span>
      {dirty && <span className={styles.pending}>未保存</span>}
      <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden="true">⌄</span>
    </button>
    {open && <div id="dsh-companion-settings-body" className={styles.body}>
      {readOnly && <p className={styles.readOnly} role="status">当前设置为只读，暂时不能保存更改。</p>}
      <div className={styles.grid}>
        <label className={`${styles.field} ${styles.full}`}><span className={styles.label}>Companion Workspace ID</span><input aria-describedby="workspace-hint" className={styles.input} value={draft.workspaceId} onChange={(event) => set("workspaceId", event.currentTarget.value)} disabled={readOnly || saving} placeholder="从 Workspace 列表复制 ID" /><span id="workspace-hint" className={styles.hint}>只使用这个 Workspace；找不到时会显示恢复提示。</span></label>
        <label className={styles.field}><span className={styles.label}>Companion 名称</span><input aria-describedby="identity-hint" className={styles.input} value={draft.companionName} onChange={(event) => set("companionName", event.currentTarget.value)} disabled={readOnly || saving} /></label>
        <label className={styles.field}><span className={styles.label}>你的显示名称</span><input aria-describedby="identity-hint" className={styles.input} value={draft.userName} onChange={(event) => set("userName", event.currentTarget.value)} disabled={readOnly || saving} /></label>
        <label className={styles.field}><span className={styles.label}>偏好的称呼</span><input aria-describedby="identity-hint" className={styles.input} value={draft.preferredAddress} onChange={(event) => set("preferredAddress", event.currentTarget.value)} disabled={readOnly || saving} /></label>
        <span id="identity-hint" className={styles.srOnly}>最多 80 个字符。</span>
        <label className={styles.field}><span className={styles.label}>新关系的默认亲近度（0–100）</span><input aria-describedby="affinity-hint" className={styles.input} type="number" min="0" max="100" step="1" value={draft.defaultAffinity} onChange={(event) => set("defaultAffinity", Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0)))} disabled={readOnly || saving} /><span id="affinity-hint" className={styles.hint}>只在首次创建或显式重置时使用。</span></label>
        <label className={styles.field}><span className={styles.label}>Companion 头像</span><span className={styles.avatarRow}>{draft.companionAvatar ? <img className={styles.avatar} src={draft.companionAvatar.data} alt="Companion 头像预览" /> : <span className={styles.avatar} aria-hidden="true" />}<input aria-describedby="avatar-hint" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void avatar("companionAvatar", event)} disabled={readOnly || saving} /></span></label>
        <label className={styles.field}><span className={styles.label}>你的头像</span><span className={styles.avatarRow}>{draft.userAvatar ? <img className={styles.avatar} src={draft.userAvatar.data} alt="用户头像预览" /> : <span className={styles.avatar} aria-hidden="true" />}<input aria-describedby="avatar-hint" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void avatar("userAvatar", event)} disabled={readOnly || saving} /></span></label>
        <span id="avatar-hint" className={`${styles.hint} ${styles.full}`}>本地图片，PNG/JPEG/WebP/GIF，1 MB 以内。</span>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.affinity}>当前亲近度：{affinity === undefined ? "加载中…" : affinity}</div>
      {resetAffinity && <button className={styles.button} onClick={() => void resetAffinity().then(() => currentAffinity?.().then(setCurrentAffinity)).catch((cause) => setError(cause instanceof Error ? cause.message : "重置失败。"))} disabled={!controlsWritable}>重置为默认亲近度</button>}
      {setAffinity && <div className={styles.relationshipControl}><label className={styles.label}>直接校正亲近度（0–100）<input className={styles.input} type="number" min="0" max="100" step="1" value={affinityDraft} onChange={(event) => setAffinityDraft(event.currentTarget.value)} disabled={!controlsWritable} /></label><button className={styles.button} type="button" onClick={() => void correctAffinity()} disabled={!controlsWritable}>校正亲近度</button></div>}
      {clearSignature && <button className={styles.button} type="button" onClick={() => void clearSignature().then(() => setStatus("签名已清除")).catch((cause) => setError(cause instanceof Error ? cause.message : "签名清除失败。"))} disabled={!controlsWritable}>清除 Companion 签名</button>}
      <div className={styles.actions}><span className={styles.status} role="status" aria-live="polite">{readOnly ? "当前设置为只读" : status}</span>{dirty && <button type="button" className={styles.button} onClick={discard} disabled={saving}>撤销</button>}<button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void save()} disabled={readOnly || !dirty || saving}>保存</button></div>
    </div>}
  </li>;
}
