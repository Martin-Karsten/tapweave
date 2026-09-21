// Private demo protocol. These values describe client reports, never judgements.
export const PROTOCOL_VERSION = 1;
export const DEMO_DURATION_MS = 75_000;
export const RECONNECT_MS = 30_000;
export interface Score_Report {
  score: number;
  accuracy: number;
  combo: number;
  progress: number;
}

export interface Terminal_Report extends Score_Report {
  status: 'completed' | 'failed' | 'withdrawn';
}

export interface Room_Member {
  member_id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
}

export interface Room_Round {
  round_id: string;
  start_ms: number;
  deadline_ms: number;
  participants: string[];
  results: Record<string, Terminal_Report>;
}

export interface Room_Snapshot {
  version: 1;
  type: 'snapshot';
  sequence: number;
  room_id: string;
  member_id: string;
  host_id: string;
  phase: 'lobby' | 'countdown' | 'playing' | 'results';
  members: Room_Member[];
  round: Room_Round | null;
  identity: string;
  expires_ms: number;
}

export type Client_Command =
  | {
      type: 'clock';
      client_ms: number;
    }
  | {
      type: 'ready';
      ready: boolean;
      identity: string;
    }
  | {
      type: 'start' | 'rematch' | 'leave';
    }
  | {
      type: 'score';
      round_id: string;
      report: Score_Report;
    }
  | {
      type: 'terminal';
      round_id: string;
      report: Terminal_Report;
    };

// The browser assigns the protocol envelope when sending a command.
export type Client_Message = Client_Command & {
  version: 1;
  sequence: number;
};

export type Server_Message =
  | Room_Snapshot
  | {
      version: 1;
      type: 'clock';
      sequence: number;
      client_ms: number;
      server_ms: number;
    }
  | {
      version: 1;
      type: 'score';
      member_id: string;
      round_id: string;
      sequence: number;
      report: Score_Report;
    }
  | {
      version: 1;
      type: 'error';
      code: string;
      message: string;
    };

export function valid_score(report: unknown): report is Score_Report {
  if (!report || typeof report !== 'object') {
    return false;
  }
  const candidate = report as Score_Report;
  return (
    Number.isSafeInteger(candidate.score) &&
    candidate.score >= 0 &&
    candidate.score <= 1_000_000_000 &&
    Number.isFinite(candidate.accuracy) &&
    candidate.accuracy >= 0 &&
    candidate.accuracy <= 1 &&
    Number.isInteger(candidate.combo) &&
    candidate.combo >= 0 &&
    candidate.combo <= 1_000_000 &&
    Number.isFinite(candidate.progress) &&
    candidate.progress >= 0 &&
    candidate.progress <= 1
  );
}

export function parse_client_message(raw: string): Client_Message {
  if (new TextEncoder().encode(raw).byteLength > 4096) {
    throw new Error('Message exceeds 4 KiB.');
  }
  const message = JSON.parse(raw);
  if (
    !message ||
    message.version !== 1 ||
    !Number.isSafeInteger(message.sequence) ||
    message.sequence < 1
  ) {
    throw new Error('Invalid protocol or sequence.');
  }
  switch (message.type) {
    case 'clock':
      if (!Number.isFinite(message.client_ms) || message.client_ms < 0) {
        throw new Error('Invalid clock sample.');
      }
      break;
    case 'ready':
      if (
        typeof message.ready !== 'boolean' ||
        typeof message.identity !== 'string' ||
        message.identity.length > 256
      ) {
        throw new Error('Invalid readiness.');
      }
      break;
    case 'start':
    case 'rematch':
    case 'leave':
      break;
    case 'score':
    case 'terminal':
      if (
        typeof message.round_id !== 'string' ||
        message.round_id.length > 64 ||
        !valid_score(message.report)
      ) {
        throw new Error('Invalid score report.');
      }
      if (
        message.type === 'terminal' &&
        !['completed', 'failed', 'withdrawn'].includes(message.report.status)
      ) {
        throw new Error('Invalid terminal state.');
      }
      // Persist only protocol fields, never arbitrary client properties.
      message.report = {
        score: message.report.score,
        accuracy: message.report.accuracy,
        combo: message.report.combo,
        progress: message.report.progress,
        ...(message.type === 'terminal' ? { status: message.report.status } : {}),
      };
      break;
    default:
      throw new Error('Unknown message type.');
  }
  return message;
}

export function ranked_results(round: Room_Round) {
  const completed_results = Object.entries(round.results)
    .filter(([, report]) => report.status === 'completed')
    .sort((left, right) => right[1].score - left[1].score);
  return completed_results.map(([member_id, report]) => ({
    member_id,
    ...report,
    placement: completed_results.findIndex(([, other_report]) => other_report.score === report.score) + 1,
  }));
}
