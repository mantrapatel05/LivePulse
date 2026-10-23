export type PipelineScene = "happy" | "retry" | "dead";
type PipelineEdge =
  | "sdk-collector"
  | "collector-socket"
  | "socket-dashboard"
  | "collector-redis"
  | "redis-worker"
  | "worker-ch"
  | "collector-mongo"
  | "worker-dlq";

type TimelineEvent = {
  at: number;
  edge: PipelineEdge;
  stage: string;
  label: string;
};

export const PIPELINE_TIMELINES: Record<PipelineScene, TimelineEvent[]> = {
  happy: [
    { at: 0, edge: "sdk-collector", stage: "sdk", label: "batch flush" },
    { at: 1500, edge: "sdk-collector", stage: "collector", label: "key + schema valid" },
    { at: 2600, edge: "collector-socket", stage: "socket", label: "room broadcast" },
    { at: 3400, edge: "socket-dashboard", stage: "dashboard", label: "visitor row appears" },
    { at: 3900, edge: "collector-mongo", stage: "mongo", label: "operational copy" },
    { at: 4700, edge: "collector-redis", stage: "redis", label: "XADD · pending 1" },
    { at: 5900, edge: "redis-worker", stage: "worker", label: "XREADGROUP · batch 500" },
    { at: 7350, edge: "worker-ch", stage: "clickhouse", label: "insert · XACK" },
  ],
  retry: [
    { at: 0, edge: "sdk-collector", stage: "sdk", label: "batch flush" },
    { at: 1500, edge: "sdk-collector", stage: "collector", label: "key + schema valid" },
    { at: 2600, edge: "collector-socket", stage: "socket", label: "room broadcast" },
    { at: 3400, edge: "socket-dashboard", stage: "dashboard", label: "visitor row appears" },
    { at: 3900, edge: "collector-mongo", stage: "mongo", label: "operational copy" },
    { at: 4700, edge: "collector-redis", stage: "redis", label: "XADD · pending 1" },
    { at: 5900, edge: "redis-worker", stage: "worker", label: "worker-1 stops" },
    { at: 7700, edge: "redis-worker", stage: "worker-2", label: "30s idle · reclaim" },
    { at: 8800, edge: "worker-ch", stage: "clickhouse", label: "attempt 2/5 · insert" },
    { at: 9600, edge: "worker-ch", stage: "clickhouse", label: "XACK · pending 0" },
  ],
  dead: [
    { at: 0, edge: "sdk-collector", stage: "sdk", label: "poison event" },
    { at: 1500, edge: "collector-redis", stage: "redis", label: "XADD · pending 1" },
    { at: 3100, edge: "redis-worker", stage: "worker", label: "attempt 1/5" },
    { at: 4100, edge: "redis-worker", stage: "worker", label: "attempt 2/5" },
    { at: 5100, edge: "redis-worker", stage: "worker", label: "attempt 3/5" },
    { at: 6100, edge: "redis-worker", stage: "worker", label: "attempt 4/5" },
    { at: 7100, edge: "redis-worker", stage: "worker", label: "attempt 5/5" },
    { at: 8300, edge: "worker-dlq", stage: "dlq", label: "moved to dead stream" },
  ],
};
