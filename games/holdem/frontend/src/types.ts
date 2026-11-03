export interface Player {
  id: string;
  name: string;
  emoji: string;
  chips: number;
  seat: number;
  ready: boolean;
  status: 'active' | 'folded' | 'all_in' | 'sitting_out';
  current_bet: number;
  total_bet_this_hand: number;
  has_acted: boolean;
  is_connected: boolean;
  last_action: string | null;
  total_rebuys: number;
  total_cashouts: number;
}

export interface SettlementProposal {
  proposer_id: string;
  pot_winners: Record<string, string[]>;
  confirmed_by: string[];
}

export interface PotInfo {
  id: string;
  amount: number;
  eligible_players: string[];
}

export interface HandState {
  phase: 'hand_start' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'hand_end';
  dealer_seat: number;
  sb_seat: number;
  bb_seat: number;
  current_bet: number;
  pot: number;
  pots: PotInfo[];
  current_player_id: string | null;
  action_order: string[];
  action_index: number;
  last_raiser_id: string | null;
  settlement_proposal: SettlementProposal | null;
}

export interface Room {
  id: string;
  status: 'waiting' | 'playing' | 'finished';
  owner_id: string;
  sb_amount: number;
  bb_amount: number;
  initial_chips: number;
  rebuy_minimum: number;
  hand_interval: number;
  max_chips: number;
  players: Record<string, Player>;
  seats: Record<number, string | null>;
  hand: HandState | null;
  hand_number: number;
}

export interface Standing {
  player_id: string;
  player_name: string;
  player_emoji: string;
  chips: number;
  total_rebuys: number;
  total_cashouts: number;
  total_investment: number;
  net: number;
}

export interface RoomListItem {
  id: string;
  owner_name: string;
  owner_emoji: string;
  sb_amount: number;
  bb_amount: number;
  initial_chips: number;
  player_count: number;
  status: string;
}

export interface WsMessage {
  type: string;
  [key: string]: any;
}
