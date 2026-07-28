"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type View = "home" | "setup" | "check" | "test" | "result" | "history";
type GameId = "apex" | "cs2" | "delta";
type ModuleId = "single" | "multi" | "tracking" | "recoil";

type GameProfile = {
  id: GameId;
  name: string;
  shortName: string;
  yaw: number;
  version: string;
  accent: string;
};

type SetupData = {
  game: GameId;
  dpi: number;
  sensitivity: number;
  width: number;
  height: number;
  refreshRate: number;
};

type RoundResult = {
  candidateCm: number;
  module: ModuleId;
  hits: number;
  misses: number;
  averageMs: number;
  score: number;
};

type Recommendation = {
  id: string;
  createdAt: string;
  game: GameId;
  dpi: number;
  previousSensitivity: number;
  previousCm: number;
  recommendedSensitivity: number;
  recommendedCm: number;
  bestCandidateCm: number;
  interval: [number, number];
  confidence: "中" | "低";
  sampleCount: number;
  algorithmVersion: string;
  results: RoundResult[];
};

const GAME_PROFILES: Record<GameId, GameProfile> = {
  apex: {
    id: "apex",
    name: "Apex Legends",
    shortName: "APEX",
    yaw: 0.022,
    version: "线性模型 v0.1",
    accent: "#73f2cc",
  },
  cs2: {
    id: "cs2",
    name: "Counter-Strike 2",
    shortName: "CS2",
    yaw: 0.022,
    version: "线性模型 v0.1",
    accent: "#7bb9ff",
  },
  delta: {
    id: "delta",
    name: "三角洲行动",
    shortName: "DELTA",
    yaw: 0.022,
    version: "MVP 校准模型 v0.1",
    accent: "#bb91ff",
  },
};

const DEFAULT_SETUP: SetupData = {
  game: "apex",
  dpi: 800,
  sensitivity: 1.5,
  width: 1920,
  height: 1080,
  refreshRate: 144,
};

const HIT_TARGET = 20;
const MULTI_HIT_TARGET = 30;

const TEST_MODULES: Array<{
  id: ModuleId;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "single",
    label: "单点精准定位",
    title: "先从微调与首发精度开始",
    description: "依次点击 20 个目标，误点会影响本模块得分。",
  },
  {
    id: "multi",
    label: "多目标连续点击",
    title: "切换目标，保持点击节奏",
    description: "场上同时存在多个目标，连续命中 30 次完成模块。",
  },
  {
    id: "tracking",
    label: "移动目标跟枪",
    title: "让指针持续跟住移动目标",
    description: "将鼠标保持在移动目标上 12 秒，覆盖时间越长越好。",
  },
  {
    id: "recoil",
    label: "模拟后坐力控制",
    title: "按住画布，持续向下补偿",
    description: "按住测试区域任意位置并移动 8 秒，使弹着点尽量留在中心区域。",
  },
];

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cmPer360(game: GameId, dpi: number, sensitivity: number) {
  const profile = GAME_PROFILES[game];
  return (360 / (profile.yaw * dpi * sensitivity)) * 2.54;
}

function sensitivityFromCm(game: GameId, dpi: number, cm: number) {
  const profile = GAME_PROFILES[game];
  return (360 * 2.54) / (profile.yaw * dpi * cm);
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function randomTarget() {
  return {
    left: 8 + Math.random() * 82,
    top: 14 + Math.random() * 72,
  };
}

function randomTargetSet(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${Date.now()}-${index}-${Math.random()}`,
    ...randomTarget(),
  }));
}

function aggregateCandidates(results: RoundResult[]) {
  const grouped = new Map<number, RoundResult[]>();
  results.forEach((result) => {
    grouped.set(result.candidateCm, [...(grouped.get(result.candidateCm) ?? []), result]);
  });
  return [...grouped.entries()].map(([candidateCm, items]) => ({
    candidateCm,
    score: Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length),
  }));
}

function IconMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
    </span>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [setup, setSetup] = useState<SetupData>(DEFAULT_SETUP);
  const [history, setHistory] = useState<Recommendation[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [copyState, setCopyState] = useState("复制结果");
  const [environment, setEnvironment] = useState({
    width: 0,
    pointerLock: false,
    pixelRatio: 1,
    desktop: true,
  });

  const [candidateOrder, setCandidateOrder] = useState<number[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [moduleIndex, setModuleIndex] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [hitTimes, setHitTimes] = useState<number[]>([]);
  const [target, setTarget] = useState(randomTarget);
  const [multiTargets, setMultiTargets] = useState(() => randomTargetSet(5));
  const [roundStartedAt, setRoundStartedAt] = useState(0);
  const [lastTargetAt, setLastTargetAt] = useState(0);
  const [roundReady, setRoundReady] = useState(false);
  const [moduleProgress, setModuleProgress] = useState(0);
  const [liveScore, setLiveScore] = useState(0);
  const [scoreFeedback, setScoreFeedback] = useState<{
    id: number;
    left: number;
    top: number;
    value: number;
  } | null>(null);
  const [trackingActive, setTrackingActive] = useState(false);
  const [trackingScore, setTrackingScore] = useState(0);
  const [trackingStreak, setTrackingStreak] = useState(0);
  const [recoilHeld, setRecoilHeld] = useState(false);
  const [recoilLiveScore, setRecoilLiveScore] = useState(100);
  const [recoilPosition, setRecoilPosition] = useState({ x: 50, y: 50 });
  const [pointerLocked, setPointerLocked] = useState(false);
  const [virtualCursor, setVirtualCursor] = useState({ x: 50, y: 50 });
  const [compatibilityMode, setCompatibilityMode] = useState(false);
  const arenaRef = useRef<HTMLDivElement>(null);
  const trackingTargetRef = useRef<HTMLButtonElement>(null);
  const moduleTimerRef = useRef<number | null>(null);
  const pointerLockedRef = useRef(false);
  const virtualCursorRef = useRef({ x: 50, y: 50 });
  const trackingActiveRef = useRef(false);
  const trackingOnTargetRef = useRef(0);
  const trackingStreakRef = useRef(0);
  const pointScoresRef = useRef<number[]>([]);
  const recoilHeldRef = useRef(false);
  const recoilPositionRef = useRef({ x: 50, y: 50 });
  const recoilDistanceRef = useRef(0);
  const recoilSamplesRef = useRef(0);

  const profile = GAME_PROFILES[setup.game];
  const activeModule = TEST_MODULES[moduleIndex];
  const currentCm = useMemo(
    () => cmPer360(setup.game, Math.max(100, setup.dpi), Math.max(0.01, setup.sensitivity)),
    [setup],
  );
  const edpi = setup.dpi * setup.sensitivity;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("aimtune-history");
      if (saved) setHistory(JSON.parse(saved).slice(0, 3));
    } catch {
      // Local storage is optional; the test remains usable without it.
    }
  }, []);

  useEffect(() => {
    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === arenaRef.current;
      pointerLockedRef.current = locked;
      setPointerLocked(locked);
    };
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    return () => document.removeEventListener("pointerlockchange", handlePointerLockChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnvironment({
      width: window.innerWidth,
      desktop: window.innerWidth >= 960,
      pointerLock: "pointerLockElement" in document,
      pixelRatio: window.devicePixelRatio || 1,
    });
  }, [view]);

  useEffect(() => {
    return () => {
      if (moduleTimerRef.current) window.clearInterval(moduleTimerRef.current);
    };
  }, []);

  function updateSetup<K extends keyof SetupData>(key: K, value: SetupData[K]) {
    setSetup((current) => ({ ...current, [key]: value }));
  }

  function beginCheck() {
    setSetup((current) => ({
      ...current,
      dpi: clampNumber(current.dpi, 100, 12800),
      sensitivity: clampNumber(current.sensitivity, 0.01, 20),
      width: clampNumber(current.width, 800, 7680),
      height: clampNumber(current.height, 600, 4320),
      refreshRate: clampNumber(current.refreshRate, 30, 540),
    }));
    setView("check");
  }

  function beginTest() {
    const candidates = [currentCm * 0.75, currentCm, currentCm * 1.25]
      .map((value) => Number(value.toFixed(3)))
      .sort(() => Math.random() - 0.5);
    setCandidateOrder(candidates);
    setRoundIndex(0);
    setModuleIndex(0);
    setRoundResults([]);
    setRoundReady(true);
    setHits(0);
    setMisses(0);
    setHitTimes([]);
    setTarget(randomTarget());
    setMultiTargets(randomTargetSet(5));
    setModuleProgress(0);
    setCompatibilityMode(false);
    setView("test");
  }

  function startRound() {
    if (moduleTimerRef.current) window.clearInterval(moduleTimerRef.current);
    const now = performance.now();
    setHits(0);
    setMisses(0);
    setHitTimes([]);
    setTarget(randomTarget());
    setMultiTargets(randomTargetSet(5));
    setRoundStartedAt(now);
    setLastTargetAt(now);
    setModuleProgress(0);
    setLiveScore(0);
    setScoreFeedback(null);
    pointScoresRef.current = [];
    setTrackingScore(0);
    setTrackingStreak(0);
    setRecoilLiveScore(100);
    virtualCursorRef.current = { x: 50, y: 50 };
    setVirtualCursor({ x: 50, y: 50 });
    setRoundReady(false);

    {
      try {
        const lockRequest = arenaRef.current?.requestPointerLock();
        lockRequest?.catch(() => {
          pointerLockedRef.current = false;
          setPointerLocked(false);
          setCompatibilityMode(true);
        });
      } catch {
        pointerLockedRef.current = false;
        setPointerLocked(false);
        setCompatibilityMode(true);
      }
    }

    if (activeModule.id === "tracking") {
      trackingActiveRef.current = false;
      trackingOnTargetRef.current = 0;
      trackingStreakRef.current = 0;
      setTrackingActive(false);
      setTrackingScore(0);
      setTrackingStreak(0);
      let elapsed = 0;
      moduleTimerRef.current = window.setInterval(() => {
        elapsed += 100;
        if (
          pointerLockedRef.current &&
          arenaRef.current &&
          trackingTargetRef.current
        ) {
          const arenaRect = arenaRef.current.getBoundingClientRect();
          const targetRect = trackingTargetRef.current.getBoundingClientRect();
          const cursor = virtualCursorRef.current;
          const cursorX = arenaRect.left + (cursor.x / 100) * arenaRect.width;
          const cursorY = arenaRect.top + (cursor.y / 100) * arenaRect.height;
          const targetX = targetRect.left + targetRect.width / 2;
          const targetY = targetRect.top + targetRect.height / 2;
          const locked = Math.hypot(cursorX - targetX, cursorY - targetY) <= 34;
          trackingActiveRef.current = locked;
          setTrackingActive(locked);
        }
        if (trackingActiveRef.current) {
          trackingOnTargetRef.current += 100;
          trackingStreakRef.current += 100;
        } else {
          trackingStreakRef.current = 0;
        }
        setTrackingScore(
          Math.round((trackingOnTargetRef.current / Math.max(100, elapsed)) * 100),
        );
        setTrackingStreak(trackingStreakRef.current);
        setModuleProgress(Math.min(100, (elapsed / 12000) * 100));
        if (elapsed >= 12000) {
          if (moduleTimerRef.current) window.clearInterval(moduleTimerRef.current);
          moduleTimerRef.current = null;
          const ratio = trackingOnTargetRef.current / 12000;
          completeModule({
            hits: Math.round(ratio * 100),
            misses: Math.round((1 - ratio) * 10),
            averageMs: Math.round((1 - ratio) * 1000),
            score: Math.max(1, Math.round(ratio * 100)),
          });
        }
      }, 100);
    }

    if (activeModule.id === "recoil") {
      recoilHeldRef.current = false;
      setRecoilHeld(false);
      recoilPositionRef.current = { x: 50, y: 50 };
      recoilDistanceRef.current = 0;
      recoilSamplesRef.current = 0;
      setRecoilLiveScore(100);
      setRecoilPosition({ x: 50, y: 50 });
      let elapsed = 0;
      moduleTimerRef.current = window.setInterval(() => {
        elapsed += 80;
        const current = recoilPositionRef.current;
        const next = {
          x: clampNumber(current.x + (Math.random() - 0.5) * 1.5, 6, 94),
          y: clampNumber(current.y - 1.15, 6, 94),
        };
        recoilPositionRef.current = next;
        recoilDistanceRef.current += Math.hypot(next.x - 50, next.y - 50);
        recoilSamplesRef.current += 1;
        setRecoilLiveScore(
          Math.max(
            0,
            Math.round(
              100 -
                (recoilDistanceRef.current / Math.max(1, recoilSamplesRef.current)) *
                  3.1,
            ),
          ),
        );
        setRecoilPosition(next);
        setModuleProgress(Math.min(100, (elapsed / 8000) * 100));
        if (elapsed >= 8000) {
          if (moduleTimerRef.current) window.clearInterval(moduleTimerRef.current);
          moduleTimerRef.current = null;
          const averageDistance =
            recoilDistanceRef.current / Math.max(1, recoilSamplesRef.current);
          completeModule({
            hits: Math.max(0, Math.round(100 - averageDistance * 3)),
            misses: Math.round(averageDistance),
            averageMs: Math.round(averageDistance * 10),
            score: Math.max(1, Math.round(100 - averageDistance * 3.1)),
          });
        }
      }, 80);
    }
  }

  function completeModule(metrics: {
    hits: number;
    misses: number;
    averageMs: number;
    score: number;
  }) {
    if (document.pointerLockElement === arenaRef.current) {
      document.exitPointerLock();
    }
    const roundResult: RoundResult = {
      candidateCm: candidateOrder[roundIndex],
      module: activeModule.id,
      hits: metrics.hits,
      misses: metrics.misses,
      averageMs: metrics.averageMs,
      score: metrics.score,
    };
    const nextResults = [...roundResults, roundResult];
    setRoundResults(nextResults);

    if (moduleIndex < TEST_MODULES.length - 1) {
      setModuleIndex((index) => index + 1);
      setRoundReady(true);
      setModuleProgress(0);
      return;
    }

    if (roundIndex < candidateOrder.length - 1) {
      setRoundIndex((index) => index + 1);
      setModuleIndex(0);
      setRoundReady(true);
      setModuleProgress(0);
      return;
    }

    const sorted = aggregateCandidates(nextResults).sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    const scoreGap = winner.score - sorted[1].score;
    const maxScore = winner.score;
    const temperature = 7;
    const weightedCandidates = sorted.map((candidate) => ({
      ...candidate,
      weight: Math.exp((candidate.score - maxScore) / temperature),
    }));
    const totalWeight = weightedCandidates.reduce(
      (sum, candidate) => sum + candidate.weight,
      0,
    );
    const weightedLogCm =
      weightedCandidates.reduce(
        (sum, candidate) => sum + candidate.weight * Math.log(candidate.candidateCm),
        0,
      ) / totalWeight;
    const recommendedCm = Math.exp(weightedLogCm);
    const weightedVariance =
      weightedCandidates.reduce(
        (sum, candidate) =>
          sum +
          candidate.weight *
            Math.pow(Math.log(candidate.candidateCm) - weightedLogCm, 2),
        0,
      ) / totalWeight;
    const intervalRatio = clampNumber(
      0.05 + Math.sqrt(weightedVariance) * 0.55 + (scoreGap < 4 ? 0.03 : 0),
      0.06,
      0.16,
    );
    const clickSampleCount = nextResults
      .filter((result) => result.module === "single" || result.module === "multi")
      .reduce((sum, result) => sum + result.hits + result.misses, 0);
    const recommendedSensitivity = sensitivityFromCm(
      setup.game,
      setup.dpi,
      recommendedCm,
    );
    const recommendationResult: Recommendation = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      game: setup.game,
      dpi: setup.dpi,
      previousSensitivity: setup.sensitivity,
      previousCm: currentCm,
      recommendedSensitivity,
      recommendedCm,
      bestCandidateCm: winner.candidateCm,
      interval: [
        recommendedCm * (1 - intervalRatio),
        recommendedCm * (1 + intervalRatio),
      ],
      confidence:
        !compatibilityMode &&
        clickSampleCount >= 150 &&
        scoreGap >= 4 &&
        intervalRatio <= 0.12
          ? "中"
          : "低",
      sampleCount: clickSampleCount,
      algorithmVersion: compatibilityMode
        ? "log-softmax-v0.2-compat"
        : "log-softmax-v0.2",
      results: nextResults,
    };
    setRecommendation(recommendationResult);
    const nextHistory = [
      recommendationResult,
      ...history.filter((item) => item.id !== recommendationResult.id),
    ].slice(0, 3);
    setHistory(nextHistory);
    try {
      window.localStorage.setItem("aimtune-history", JSON.stringify(nextHistory));
    } catch {
      // The result still remains available in memory.
    }
    setView("result");
  }

  function handleTargetHit(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const distance = Math.hypot(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + rect.height / 2),
    );
    const radiusRatio = clampNumber(distance / (rect.width / 2), 0, 1);
    registerSingleHit(Math.round(100 - radiusRatio * 70));
  }

  function registerSingleHit(points: number) {
    if (roundReady || hits >= HIT_TARGET) return;
    const now = performance.now();
    const nextHitTimes = [...hitTimes, now - lastTargetAt];
    const nextHits = hits + 1;
    const nextPointScores = [...pointScoresRef.current, points];
    const feedbackId = Date.now();
    pointScoresRef.current = nextPointScores;
    setHits(nextHits);
    setHitTimes(nextHitTimes);
    setLiveScore(nextPointScores.reduce((sum, value) => sum + value, 0));
    setScoreFeedback({
      id: feedbackId,
      left: target.left,
      top: target.top,
      value: points,
    });
    window.setTimeout(() => {
      setScoreFeedback((current) => current?.id === feedbackId ? null : current);
    }, 620);
    setLastTargetAt(now);
    setTarget(randomTarget());
    if (nextHits === HIT_TARGET) {
      const averageMs =
        nextHitTimes.reduce((sum, time) => sum + time, 0) / Math.max(1, nextHitTimes.length);
      const averagePrecision =
        nextPointScores.reduce((sum, value) => sum + value, 0) /
        Math.max(1, nextPointScores.length);
      const speedScore = clampNumber(100 - Math.max(0, averageMs - 320) / 11, 10, 100);
      completeModule({
        hits: HIT_TARGET,
        misses,
        averageMs: Math.round(averageMs),
        score: Math.max(
          1,
          Math.round(averagePrecision * 0.65 + speedScore * 0.35 - misses * 5),
        ),
      });
    }
  }

  function handleMultiTargetHit(event: React.MouseEvent<HTMLButtonElement>, targetId: string) {
    event.stopPropagation();
    registerMultiTargetHit(targetId);
  }

  function registerMultiTargetHit(targetId: string) {
    if (roundReady || hits >= MULTI_HIT_TARGET) return;
    const now = performance.now();
    const nextHitTimes = [...hitTimes, now - lastTargetAt];
    const nextHits = hits + 1;
    setHits(nextHits);
    setHitTimes(nextHitTimes);
    setLastTargetAt(now);
    setMultiTargets((current) =>
      current.map((item) =>
        item.id === targetId
          ? { id: `${Date.now()}-${Math.random()}`, ...randomTarget() }
          : item,
      ),
    );
    if (nextHits === MULTI_HIT_TARGET) {
      const averageMs =
        nextHitTimes.reduce((sum, time) => sum + time, 0) / Math.max(1, nextHitTimes.length);
      completeModule({
        hits: MULTI_HIT_TARGET,
        misses,
        averageMs: Math.round(averageMs),
        score: Math.max(1, Math.round(100 - Math.max(0, averageMs - 300) / 16 - misses * 6)),
      });
    }
  }

  function handleArenaClick() {
    if (roundReady) return;
    if (!pointerLockedRef.current) {
      if (activeModule.id === "single" || activeModule.id === "multi") {
        setMisses((value) => value + 1);
      }
      return;
    }

    const arena = arenaRef.current;
    if (!arena) return;
    const rect = arena.getBoundingClientRect();
    const cursor = virtualCursorRef.current;
    const distanceTo = (position: { left: number; top: number }) =>
      Math.hypot(
        ((cursor.x - position.left) / 100) * rect.width,
        ((cursor.y - position.top) / 100) * rect.height,
      );

    if (activeModule.id === "single") {
      const distance = distanceTo(target);
      if (distance <= 22) {
        registerSingleHit(Math.round(100 - clampNumber(distance / 22, 0, 1) * 70));
      }
      else setMisses((value) => value + 1);
    }

    if (activeModule.id === "multi") {
      const closest = [...multiTargets].sort(
        (a, b) => distanceTo(a) - distanceTo(b),
      )[0];
      if (closest && distanceTo(closest) <= 28) registerMultiTargetHit(closest.id);
      else setMisses((value) => value + 1);
    }
  }

  function applyRecoilMovement(movementX: number, movementY: number) {
    const current = recoilPositionRef.current;
    const gain = currentCm / Math.max(1, candidateOrder[roundIndex] ?? currentCm);
    const next = {
      x: clampNumber(current.x + movementX * 0.22 * gain, 6, 94),
      y: clampNumber(current.y + movementY * 0.22 * gain, 6, 94),
    };
    recoilPositionRef.current = next;
    setRecoilPosition(next);
  }

  function handleArenaMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!pointerLockedRef.current) return;
    if (activeModule.id === "recoil") {
      if (recoilHeldRef.current) {
        applyRecoilMovement(event.movementX, event.movementY);
      }
      return;
    }
    const arena = arenaRef.current;
    if (!arena) return;
    const gain = currentCm / Math.max(1, candidateOrder[roundIndex] ?? currentCm);
    const next = {
      x: clampNumber(
        virtualCursorRef.current.x + (event.movementX * gain * 100) / arena.clientWidth,
        0,
        100,
      ),
      y: clampNumber(
        virtualCursorRef.current.y + (event.movementY * gain * 100) / arena.clientHeight,
        0,
        100,
      ),
    };
    virtualCursorRef.current = next;
    setVirtualCursor(next);
  }

  function handleArenaMouseDown() {
    if (roundReady || activeModule.id !== "recoil") return;
    recoilHeldRef.current = true;
    setRecoilHeld(true);
  }

  function handleArenaMouseUp() {
    if (activeModule.id !== "recoil") return;
    handleRecoilPointerUp();
  }

  function setTracking(isActive: boolean) {
    trackingActiveRef.current = isActive;
    setTrackingActive(isActive);
  }

  function handleRecoilPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!pointerLockedRef.current) {
      try {
        arenaRef.current?.requestPointerLock()?.then(() => {
          setCompatibilityMode(false);
        }).catch(() => {
          setCompatibilityMode(true);
        });
      } catch {
        setCompatibilityMode(true);
      }
    }
    recoilHeldRef.current = true;
    setRecoilHeld(true);
  }

  function handleRecoilPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pointerLockedRef.current || !recoilHeldRef.current) return;
    applyRecoilMovement(event.movementX, event.movementY);
  }

  function handleRecoilPointerUp() {
    recoilHeldRef.current = false;
    setRecoilHeld(false);
  }

  async function copyResult() {
    if (!recommendation) return;
    const recommendationProfile = GAME_PROFILES[recommendation.game];
    const text = [
      `AimTune 初步建议 · ${recommendationProfile.name}`,
      `游戏内灵敏度：${formatNumber(recommendation.recommendedSensitivity, 3)}`,
      `物理距离：${formatNumber(recommendation.recommendedCm, 1)} cm/360°`,
      `合理区间：${formatNumber(recommendation.interval[0], 1)}–${formatNumber(recommendation.interval[1], 1)} cm/360°`,
      `可信度：${recommendation.confidence}（请在游戏训练场复核）`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopyState("已复制");
    window.setTimeout(() => setCopyState("复制结果"), 1800);
  }

  function exportResult() {
    if (!recommendation) return;
    const blob = new Blob([JSON.stringify(recommendation, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aimtune-${recommendation.game}-${recommendation.id.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function resetFlow() {
    setRecommendation(null);
    setRoundResults([]);
    setView("setup");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")} aria-label="返回 AimTune 首页">
          <IconMark />
          <span>AIMTUNE</span>
          <small>WEB</small>
        </button>
        <nav aria-label="主导航">
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>
            首页
          </button>
          <button onClick={() => setView("setup")}>灵敏度换算</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
            历史记录
          </button>
        </nav>
        <div className="anonymous-badge">
          <span />
          匿名模式
        </div>
      </header>

      {view === "home" && (
        <section className="home-view">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-copy">
            <div className="eyebrow">
              <span>●</span> 面向 FPS 玩家的系统化灵敏度测试
            </div>
            <h1>
              别再凭感觉
              <br />
              <span>反复改数值。</span>
            </h1>
            <p>
              用一套可解释的短测试，比较你的速度、精度与控制感，
              得到适合当前设备和游戏习惯的灵敏度起点。
            </p>
            <div className="hero-actions">
              <button className="primary-action" onClick={() => setView("setup")}>
                开始测试 <span>→</span>
              </button>
              <button className="ghost-action" onClick={() => setView("setup")}>
                只做换算
              </button>
            </div>
            <div className="hero-meta">
              <span><b>10–15</b> 分钟</span>
              <span><b>3</b> 款游戏</span>
              <span><b>0</b> 原始轨迹上传</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="灵敏度测试结果预览">
            <div className="radar-card">
              <div className="card-label">本轮表现</div>
              <div className="radar">
                <div className="radar-ring r1" />
                <div className="radar-ring r2" />
                <div className="radar-ring r3" />
                <div className="radar-shape" />
                <span className="axis top">精准</span>
                <span className="axis right">跟枪</span>
                <span className="axis bottom">稳定</span>
                <span className="axis left">转向</span>
              </div>
              <div className="score-row">
                <div><small>推荐范围</small><strong>31.2–35.8</strong><span>cm/360°</span></div>
                <div><small>可信度</small><strong className="teal">中</strong></div>
              </div>
            </div>
            <div className="floating-chip chip-one"><span /> 盲测候选值</div>
            <div className="floating-chip chip-two"><span /> 本地完成计算</div>
          </div>

          <div className="steps-strip">
            <article>
              <span>01</span>
              <div><h3>填写配置</h3><p>游戏、DPI 与当前灵敏度</p></div>
            </article>
            <i>→</i>
            <article>
              <span>02</span>
              <div><h3>完成短测</h3><p>三档候选值随机盲测</p></div>
            </article>
            <i>→</i>
            <article>
              <span>03</span>
              <div><h3>获得建议</h3><p>点值、区间与可信度</p></div>
            </article>
          </div>

          <div className="supported-games">
            <p>首批支持</p>
            {Object.values(GAME_PROFILES).map((game) => (
              <span key={game.id}>{game.shortName}</span>
            ))}
            <small>桌面端 Chrome / Edge / Firefox</small>
          </div>
        </section>
      )}

      {view === "setup" && (
        <section className="content-view setup-view">
          <div className="section-heading">
            <div>
              <span className="step-kicker">步骤 1 / 3</span>
              <h2>先告诉我们你现在怎么用</h2>
              <p>这些数据只保存在当前设备，用于换算和生成候选区间。</p>
            </div>
            <button className="text-button" onClick={() => setView("home")}>退出流程</button>
          </div>

          <div className="setup-layout">
            <form className="form-panel" onSubmit={(event) => { event.preventDefault(); beginCheck(); }}>
              <fieldset>
                <legend>目标游戏</legend>
                <div className="game-options">
                  {Object.values(GAME_PROFILES).map((game) => (
                    <label key={game.id} className={setup.game === game.id ? "selected" : ""}>
                      <input
                        type="radio"
                        name="game"
                        value={game.id}
                        checked={setup.game === game.id}
                        onChange={() => updateSetup("game", game.id)}
                      />
                      <span className="game-dot" style={{ background: game.accent }} />
                      <span><b>{game.name}</b><small>{game.version}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="field-grid">
                <label>
                  <span>鼠标 DPI <em>必填</em></span>
                  <input
                    type="number"
                    min="100"
                    max="12800"
                    step="50"
                    value={setup.dpi}
                    onChange={(event) => updateSetup("dpi", Number(event.target.value))}
                  />
                  <small>请从鼠标驱动中确认，浏览器无法自动读取硬件 DPI。</small>
                </label>
                <label>
                  <span>当前游戏内灵敏度 <em>必填</em></span>
                  <input
                    type="number"
                    min="0.01"
                    max="20"
                    step="0.01"
                    value={setup.sensitivity}
                    onChange={(event) => updateSetup("sensitivity", Number(event.target.value))}
                  />
                  <small>填写常规视角灵敏度，不含瞄准镜倍率。</small>
                </label>
              </div>

              <div className="field-grid three">
                <label>
                  <span>分辨率宽</span>
                  <input type="number" value={setup.width} onChange={(event) => updateSetup("width", Number(event.target.value))} />
                </label>
                <label>
                  <span>分辨率高</span>
                  <input type="number" value={setup.height} onChange={(event) => updateSetup("height", Number(event.target.value))} />
                </label>
                <label>
                  <span>刷新率 Hz</span>
                  <input type="number" value={setup.refreshRate} onChange={(event) => updateSetup("refreshRate", Number(event.target.value))} />
                </label>
              </div>

              <div className="form-footer">
                <div><span className="privacy-dot" /> 匿名测试 · 不上传原始鼠标轨迹</div>
                <button className="primary-action" type="submit">检查环境 <span>→</span></button>
              </div>
            </form>

            <aside className="live-converter">
              <div className="card-label">实时换算</div>
              <div className="conversion-main">
                <strong>{formatNumber(currentCm, 1)}</strong>
                <span>cm / 360°</span>
              </div>
              <div className="conversion-row">
                <span>eDPI</span>
                <b>{formatNumber(edpi, 0)}</b>
              </div>
              <div className="conversion-row">
                <span>完整转身计数</span>
                <b>{formatNumber(360 / (profile.yaw * setup.sensitivity), 0)}</b>
              </div>
              <div className="range-track">
                <span style={{ left: `${Math.min(92, Math.max(8, ((currentCm - 10) / 70) * 100))}%` }} />
              </div>
              <div className="range-labels"><span>快 · 10cm</span><span>慢 · 80cm</span></div>
              <p>
                采用 {profile.version}。这是物理距离换算与相对比较模型，最终设置需在游戏训练场复核。
              </p>
            </aside>
          </div>
        </section>
      )}

      {view === "check" && (
        <section className="content-view check-view">
          <div className="section-heading compact">
            <div>
              <span className="step-kicker">步骤 2 / 3</span>
              <h2>环境预检</h2>
              <p>正式短测前，确认浏览器处于适合采样的状态。</p>
            </div>
          </div>

          <div className="check-card">
            <div className="check-summary">
              <div className={environment.desktop && environment.pointerLock ? "status-orb good" : "status-orb warn"}>
                {environment.desktop && environment.pointerLock ? "✓" : "!"}
              </div>
              <div>
                <h3>{environment.desktop && environment.pointerLock ? "可以开始测试" : "环境需要注意"}</h3>
                <p>本轮包含单点、多目标、跟枪与压枪，完成 3 组候选对比，大约需要 5 分钟。</p>
              </div>
            </div>
            <div className="check-list">
              <div><span className={environment.desktop ? "pass" : "fail"}>{environment.desktop ? "✓" : "!"}</span><div><b>桌面宽度</b><small>{environment.width}px · 建议至少 960px</small></div></div>
              <div><span className={environment.pointerLock ? "pass" : "fail"}>{environment.pointerLock ? "✓" : "!"}</span><div><b>指针锁定能力</b><small>{environment.pointerLock ? "浏览器支持" : "当前浏览器不支持"}</small></div></div>
              <div><span className="pass">✓</span><div><b>设备像素比</b><small>{formatNumber(environment.pixelRatio, 2)} · 已记录</small></div></div>
              <div><span className="pass">✓</span><div><b>页面数据</b><small>本地处理，不上传原始轨迹</small></div></div>
            </div>
            <div className="check-notice">
              <b>开始前请确认</b>
              <span>浏览器缩放为 100%</span>
              <span>关闭鼠标加速与后台下载</span>
              <span>使用鼠标，不使用触控板</span>
            </div>
            <div className="check-actions">
              <button className="ghost-action" onClick={() => setView("setup")}>返回修改</button>
              <button className="primary-action" onClick={beginTest} disabled={!environment.desktop}>
                进入测试 <span>→</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {view === "test" && (
        <section className="test-view">
          <div className="test-topline">
            <div>
              <span className="live-dot" /> {activeModule.label}
            </div>
            <div className="round-progress">
              {TEST_MODULES.map((item, index) => (
                <span key={item.id} className={index <= moduleIndex ? "filled" : ""} />
              ))}
              候选 {roundIndex + 1} / 3 · 模块 {moduleIndex + 1} / 4
            </div>
            <button onClick={() => setView("check")}>退出测试</button>
          </div>

          <div
            ref={arenaRef}
            className={`test-arena ${pointerLocked ? "pointer-locked" : ""} ${
              activeModule.id === "tracking" && trackingActive ? "tracking-locked" : ""
            }`}
            onClick={handleArenaClick}
            onMouseMove={handleArenaMouseMove}
            onMouseDown={handleArenaMouseDown}
            onMouseUp={handleArenaMouseUp}
            role="application"
            aria-label={`${activeModule.label}测试区域`}
          >
            <div className="crosshair-guide" aria-hidden="true" />
            {compatibilityMode && !roundReady && (
              <div className="compatibility-notice">
                {activeModule.id === "recoil"
                  ? "当前预览未开放无限相对位移；按住画布会再次尝试启用，或在 Chrome / Edge 中测试"
                  : "当前浏览器未开放指针锁定，已进入兼容模式；本轮可信度将自动降级"}
              </div>
            )}
            {pointerLocked && activeModule.id !== "recoil" && (
              <div
                className="virtual-cursor"
                style={{ left: `${virtualCursor.x}%`, top: `${virtualCursor.y}%` }}
                aria-hidden="true"
              />
            )}
            {!roundReady && activeModule.id === "single" && hits < HIT_TARGET && (
              <button
                className="aim-target"
                style={{ left: `${target.left}%`, top: `${target.top}%` }}
                onClick={handleTargetHit}
                aria-label="测试目标"
              />
            )}

            {scoreFeedback && activeModule.id === "single" && (
              <div
                className="score-feedback"
                style={{ left: `${scoreFeedback.left}%`, top: `${scoreFeedback.top}%` }}
                aria-live="polite"
              >
                +{scoreFeedback.value}
              </div>
            )}

            {!roundReady && activeModule.id === "multi" &&
              multiTargets.map((item, index) => (
                <button
                  key={item.id}
                  className="aim-target multi"
                  style={{ left: `${item.left}%`, top: `${item.top}%` }}
                  onClick={(event) => handleMultiTargetHit(event, item.id)}
                  aria-label={`多目标测试目标 ${index + 1}`}
                />
              ))}

            {!roundReady && activeModule.id === "tracking" && (
              <>
                <button
                  ref={trackingTargetRef}
                  className={`tracking-target ${trackingActive ? "locked" : ""}`}
                  onMouseEnter={() => setTracking(true)}
                  onMouseLeave={() => setTracking(false)}
                  aria-label="请持续跟随的移动目标"
                >
                  <span>{trackingActive ? "+1" : "跟随"}</span>
                </button>
                <div className={`tracking-feedback ${trackingActive ? "active" : ""}`}>
                  <small>{trackingActive ? "目标锁定" : "寻找目标"}</small>
                  <strong>{trackingScore}</strong>
                  <span>实时得分 · 连续 {(trackingStreak / 1000).toFixed(1)} 秒</span>
                </div>
              </>
            )}

            {!roundReady && activeModule.id === "recoil" && (
              <div
                className="recoil-scene"
                onPointerDown={handleRecoilPointerDown}
                onPointerMove={handleRecoilPointerMove}
                onPointerUp={handleRecoilPointerUp}
                onPointerCancel={handleRecoilPointerUp}
              >
                <div className="recoil-center">
                  <span>控制区</span>
                </div>
                <div
                  className={`recoil-marker ${recoilHeld ? "held" : ""}`}
                  style={{ left: `${recoilPosition.x}%`, top: `${recoilPosition.y}%` }}
                  aria-hidden="true"
                >
                  <span />
                </div>
                <p>
                  指针锁定后可无限向下移动；兼容模式下松开后可从画布任意位置继续下拉
                </p>
              </div>
            )}

            {roundReady && (
              <div className="round-overlay">
                <span>候选方案 {roundIndex + 1} · {activeModule.label}</span>
                <h2>{activeModule.title}</h2>
                <p>灵敏度数值已隐藏。{activeModule.description}</p>
                <button className="primary-action" onClick={(event) => { event.stopPropagation(); startRound(); }}>
                  {roundIndex === 0 && moduleIndex === 0 ? "开始完整测试" : "开始本模块"} <span>→</span>
                </button>
              </div>
            )}

            {!roundReady && (activeModule.id === "single" || activeModule.id === "multi") && (
              <div className="test-hud">
                <div>
                  <small>{activeModule.id === "single" ? "累计得分" : "命中"}</small>
                  <strong>
                    {activeModule.id === "single" ? liveScore : hits}
                    <span> / {activeModule.id === "single" ? HIT_TARGET * 100 : MULTI_HIT_TARGET}</span>
                  </strong>
                </div>
                <div>
                  <small>{activeModule.id === "single" ? "完成进度" : "误点"}</small>
                  <strong>
                    {activeModule.id === "single" ? hits : misses}
                    {activeModule.id === "single" && <span> / {HIT_TARGET}</span>}
                  </strong>
                </div>
                <div><small>状态</small><strong>{roundStartedAt ? "进行中" : "—"}</strong></div>
              </div>
            )}

            {!roundReady && activeModule.id === "tracking" && (
              <div className="test-hud">
                <div><small>跟随状态</small><strong>{trackingActive ? "锁定" : "脱靶"}</strong></div>
                <div><small>实时得分</small><strong>{trackingScore}<span> / 100</span></strong></div>
                <div><small>连续跟随</small><strong>{(trackingStreak / 1000).toFixed(1)}<span> 秒</span></strong></div>
              </div>
            )}

            {!roundReady && activeModule.id === "recoil" && (
              <div className="test-hud">
                <div><small>控制状态</small><strong>{recoilHeld ? "补偿中" : "按住画布"}</strong></div>
                <div><small>稳定得分</small><strong>{recoilLiveScore}<span> / 100</span></strong></div>
                <div><small>进度</small><strong>{Math.round(moduleProgress)}<span>%</span></strong></div>
              </div>
            )}

            {!roundReady && (activeModule.id === "tracking" || activeModule.id === "recoil") && (
              <div className="module-meter"><span style={{ width: `${moduleProgress}%` }} /></div>
            )}
          </div>
          <p className="test-caption">
            {compatibilityMode
              ? "兼容模式 · 候选增益未完全应用，结果只作初筛参考"
              : "候选灵敏度已盲测隐藏 · 四类模块均在本地运行，只保留汇总指标"}
          </p>
        </section>
      )}

      {view === "result" && recommendation && (
        <section className="content-view result-view">
          <div className="result-hero">
            <div>
              <span className="step-kicker">测试完成 · 初步建议</span>
              <h2>你的控制甜点区在这里。</h2>
              <p>
                它不是绝对答案，而是基于本轮 {recommendation.sampleCount ?? "多项"} 个有效点击样本、
                四类模块与三档候选加权得到的游戏内复核起点。
              </p>
            </div>
            <div className="confidence-pill">
              <span>可信度</span>
              <b>{recommendation.confidence}</b>
            </div>
          </div>

          <div className="result-grid">
            <article className="recommend-card">
              <div className="card-label">{GAME_PROFILES[recommendation.game].name} 推荐设置</div>
              <div className="recommend-value">
                <strong>{formatNumber(recommendation.recommendedSensitivity, 3)}</strong>
                <span>游戏内灵敏度</span>
              </div>
              <div className="cm-result">
                <div><b>{formatNumber(recommendation.recommendedCm, 1)}</b><span>cm / 360°</span></div>
                <div><b>{formatNumber(recommendation.dpi * recommendation.recommendedSensitivity, 0)}</b><span>eDPI</span></div>
              </div>
              <div className="change-note">
                相比当前设置
                <b>
                  {recommendation.recommendedSensitivity >= recommendation.previousSensitivity ? " +" : " "}
                  {formatNumber(
                    ((recommendation.recommendedSensitivity - recommendation.previousSensitivity) /
                      recommendation.previousSensitivity) *
                      100,
                    1,
                  )}%
                </b>
              </div>
            </article>

            <article className="interval-card">
              <div className="card-label">合理区间</div>
              <h3>{formatNumber(recommendation.interval[0], 1)}–{formatNumber(recommendation.interval[1], 1)} <span>cm/360°</span></h3>
              <div className="interval-track">
                <div />
                <span style={{ left: "50%" }} />
              </div>
              <div className="interval-labels">
                <span>更快</span><b>推荐点</b><span>更稳</span>
              </div>
              <p>建议先稳定使用 2–3 天，不要在短期波动中频繁追值。</p>
            </article>

            <article className="performance-card">
              <div className="card-label">候选表现</div>
              {aggregateCandidates(recommendation.results)
                .sort((a, b) => a.candidateCm - b.candidateCm)
                .map((result, index) => (
                  <div className="performance-row" key={result.candidateCm}>
                    <span>候选 {index + 1}</span>
                    <div><i style={{ width: `${result.score}%` }} /></div>
                    <b>{result.score}</b>
                  </div>
                ))}
              <small>
                综合单点、多目标、跟枪与压枪四类模块 · {recommendation.algorithmVersion ?? "MVP v0.1"}
              </small>
              <div className="module-score-grid">
                {TEST_MODULES.map((module) => {
                  const item = recommendation.results.find(
                    (result) =>
                      result.candidateCm ===
                        (recommendation.bestCandidateCm ??
                          aggregateCandidates(recommendation.results).sort(
                            (a, b) =>
                              Math.abs(a.candidateCm - recommendation.recommendedCm) -
                              Math.abs(b.candidateCm - recommendation.recommendedCm),
                          )[0]?.candidateCm) &&
                      result.module === module.id,
                  );
                  return (
                    <div key={module.id}>
                      <span>{module.label.replace("精准定位", "").replace("移动目标", "")}</span>
                      <b>{item?.score ?? "—"}</b>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="verify-card">
              <div className="card-label">游戏内复核清单</div>
              <label><input type="checkbox" /> 训练场完成 3 次 180° 转身</label>
              <label><input type="checkbox" /> 近距离跟枪时不过度甩动</label>
              <label><input type="checkbox" /> 中远距离微调不感到拖沓</label>
              <p>Web 输入链路不同于游戏 Raw Input，最终结果以游戏内手感为准。</p>
            </article>
          </div>

          <div className="result-actions">
            <button className="primary-action" onClick={copyResult}>{copyState}</button>
            <button className="ghost-action" onClick={exportResult}>导出 JSON</button>
            <button className="text-button" onClick={resetFlow}>重新测试</button>
          </div>
        </section>
      )}

      {view === "history" && (
        <section className="content-view history-view">
          <div className="section-heading">
            <div>
              <span className="step-kicker">本地记录</span>
              <h2>最近 3 次完整测试</h2>
              <p>记录只保存在此浏览器中，不与账号或云端同步。</p>
            </div>
            <button className="primary-action small" onClick={() => setView("setup")}>开始新测试</button>
          </div>
          {history.length === 0 ? (
            <div className="empty-state">
              <IconMark />
              <h3>还没有测试记录</h3>
              <p>完成一次三档候选短测后，结果会自动出现在这里。</p>
              <button className="ghost-action" onClick={() => setView("setup")}>去完成第一次测试</button>
            </div>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <article key={item.id}>
                  <div className="history-game" style={{ color: GAME_PROFILES[item.game].accent }}>
                    {GAME_PROFILES[item.game].shortName}
                  </div>
                  <div>
                    <small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
                    <h3>{GAME_PROFILES[item.game].name}</h3>
                  </div>
                  <div><small>推荐灵敏度</small><b>{formatNumber(item.recommendedSensitivity, 3)}</b></div>
                  <div><small>物理距离</small><b>{formatNumber(item.recommendedCm, 1)} cm</b></div>
                  <button onClick={() => { setRecommendation(item); setView("result"); }}>查看结果 →</button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <footer>
        <span>AimTune MVP · 浏览器相对比较工具</span>
        <span>结果需在目标游戏内复核 · 身体不适时请停止测试</span>
      </footer>
    </main>
  );
}
