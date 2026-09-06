"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiRequest, isApiRequestError } from "@/shared/ui/api-client";
import type {
  FeaturedLearningMapSummary,
  LearningRelationshipSummary,
  LearningRelationshipCreation,
} from "@/components/contracts";
import { Overlay } from "./dialog";
import { Scanner } from "./scene";
import { requestDeadline } from "./request-deadline";
import s from "./scenes.module.css";
/** Existing catalog endpoints only. Opening a saved/featured map does not generate one. */
export function LibraryDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<readonly LearningRelationshipSummary[]>(
      [],
    ),
    [featured, setFeatured] = useState<readonly FeaturedLearningMapSummary[]>(
      [],
    );
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [joining, setJoining] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const joinController = useRef<AbortController | null>(null);
  useEffect(() => () => joinController.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    void requestDeadline(
      (signal) =>
        Promise.all([
          apiRequest<{ items: readonly LearningRelationshipSummary[] }>(
            "/api/learning-relationships",
            { signal },
          ),
          apiRequest<{ items: readonly FeaturedLearningMapSummary[] }>(
            "/api/featured-learning-maps",
            { signal },
          ),
        ]),
      c.signal,
    )
      .then(([a, b]) => {
        if (active) {
          setSaved(a.items);
          setFeatured(b.items);
        }
      })
      .catch((e) => {
        if (!active) return;
        if (isApiRequestError(e) && e.status === 401)
          router.replace("/auth?next=%2F");
        else setError("藏书暂时未能取出。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [open, reload, router]);
  async function join(map: FeaturedLearningMapSummary) {
    if (joinController.current) return;
    const existing = saved.find(
      (r) => r.mapId === map.mapId && r.versionId === map.versionId,
    );
    if (existing) {
      onClose();
      router.push(
        `/learn/${encodeURIComponent(existing.learningRelationshipId)}`,
      );
      return;
    }
    const c = new AbortController();
    joinController.current = c;
    setJoining(map.mapId);
    setError("");
    try {
      const r = await requestDeadline(
        (signal) =>
          apiRequest<LearningRelationshipCreation>(
            `/api/featured-learning-maps/${encodeURIComponent(map.mapId)}/learning-relationship`,
            { method: "POST", signal },
          ),
        c.signal,
      );
      if (!r.learningRelationshipId) throw new Error("Missing relationship");
      onClose();
      router.push(`/learn/${encodeURIComponent(r.learningRelationshipId)}`);
    } catch (e) {
      if (c.signal.aborted) return;
      if (isApiRequestError(e) && e.status === 401)
        router.replace("/auth?next=%2F");
      else setError("这一卷暂未打开，请稍后再试。");
    } finally {
      if (joinController.current === c) {
        joinController.current = null;
        setJoining(null);
      }
    }
  }
  return (
    <Overlay
      open={open}
      title="藏书"
      drawer
      busy={joining !== null}
      onClose={onClose}
    >
      <div className={s.drawerBody}>
        <span className={s.eyebrow}>On the shelf</span>
        <h2>藏书</h2>
        {loading ? (
          <Scanner compact label="取出卷册" />
        ) : (
          <>
            <h3 className={s.libraryHeading}>我的卷册</h3>
            <ul className={s.libraryList}>
              {saved.map((r) => (
                <li key={r.learningRelationshipId}>
                  <Link
                    onClick={onClose}
                    href={`/learn/${encodeURIComponent(r.learningRelationshipId)}`}
                  >
                    {r.title}
                    <span aria-hidden="true">↗</span>
                  </Link>
                </li>
              ))}
            </ul>
            {!saved.length && <p>还没有收藏。</p>}
            <h3 className={s.libraryHeading}>精选卷册</h3>
            <ul className={s.libraryList}>
              {featured.map((m) => (
                <li key={m.mapId}>
                  <button
                    disabled={joining !== null}
                    onClick={() => void join(m)}
                  >
                    {m.title}
                    <span>
                      {joining === m.mapId ? "取卷中" : `${m.nodeCount} 章 ↗`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <>
            <p className={s.error} role="alert">
              {error}
            </p>
            <button
              className={s.secondary}
              onClick={() => setReload((r) => r + 1)}
            >
              重新取卷 ↻
            </button>
          </>
        )}
      </div>
    </Overlay>
  );
}
