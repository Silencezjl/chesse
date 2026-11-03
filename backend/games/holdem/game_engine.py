from __future__ import annotations
import uuid
from typing import Optional
from .models import (
    Room, HandState, HandPhase, Player, PlayerAction,
    PlayerStatus, PotInfo, RoomStatus, SettlementProposal,
)


def get_seated_players(room: Room) -> list[Player]:
    """Return players sorted by seat index who are seated (including disconnected)."""
    seated = []
    for seat_idx in sorted(room.seats.keys()):
        pid = room.seats[seat_idx]
        if pid and pid in room.players:
            p = room.players[pid]
            if p.seat >= 0:
                seated.append(p)
    return seated


def get_connected_seated_players(room: Room) -> list[Player]:
    """Return seated players who are currently connected."""
    return [p for p in get_seated_players(room) if p.is_connected]


def get_active_players(room: Room) -> list[Player]:
    """Players who haven't folded and are seated."""
    return [p for p in get_seated_players(room) if p.status != PlayerStatus.FOLDED and p.status != PlayerStatus.SITTING_OUT]


def get_actionable_players(room: Room) -> list[Player]:
    """Players who can still act (not folded, not all-in)."""
    return [p for p in get_active_players(room) if p.status != PlayerStatus.ALL_IN]


def find_next_dealer(room: Room) -> int:
    """Find next dealer seat, moving clockwise from current dealer."""
    seated = get_seated_players(room)
    if not seated:
        return -1
    
    current_dealer = room.hand.dealer_seat if room.hand else -1
    seat_indices = [p.seat for p in seated]
    
    if current_dealer == -1:
        return seat_indices[0]
    
    # Find next occupied seat after current dealer
    for s in seat_indices:
        if s > current_dealer:
            return s
    return seat_indices[0]


def find_next_seat(seat_indices: list[int], after_seat: int) -> int:
    """Find next seat in clockwise order after given seat."""
    for s in seat_indices:
        if s > after_seat:
            return s
    return seat_indices[0]


def start_hand(room: Room) -> Room:
    """Initialize a new hand."""
    seated = get_connected_seated_players(room)
    if len(seated) < 2:
        return room
    
    room.status = RoomStatus.PLAYING
    room.hand_number += 1
    
    seat_indices = [p.seat for p in seated]
    
    # Reset all seated players
    for p in seated:
        p.status = PlayerStatus.ACTIVE
        p.current_bet = 0
        p.total_bet_this_hand = 0
        p.has_acted = False
        p.last_action = None
    
    # Determine dealer position
    dealer_seat = find_next_dealer(room)
    
    if len(seated) == 2:
        # Heads-up: dealer is SB
        sb_seat = dealer_seat
        bb_seat = find_next_seat(seat_indices, sb_seat)
    else:
        sb_seat = find_next_seat(seat_indices, dealer_seat)
        bb_seat = find_next_seat(seat_indices, sb_seat)
    
    # Post blinds
    sb_player = room.players[room.seats[sb_seat]]
    bb_player = room.players[room.seats[bb_seat]]
    
    sb_actual = min(sb_player.chips, room.sb_amount)
    bb_actual = min(bb_player.chips, room.bb_amount)
    
    hand = HandState(
        phase=HandPhase.PREFLOP,
        dealer_seat=dealer_seat,
        sb_seat=sb_seat,
        bb_seat=bb_seat,
        current_bet=bb_actual,
        pot=0,
    )
    room.hand = hand
    
    sb_player.chips -= sb_actual
    sb_player.current_bet = sb_actual
    sb_player.total_bet_this_hand = sb_actual
    sb_player.last_action = f"sb:{sb_actual}"
    if sb_player.chips == 0:
        sb_player.status = PlayerStatus.ALL_IN
    
    bb_player.chips -= bb_actual
    bb_player.current_bet = bb_actual
    bb_player.total_bet_this_hand = bb_actual
    bb_player.last_action = f"bb:{bb_actual}"
    if bb_player.chips == 0:
        bb_player.status = PlayerStatus.ALL_IN
    
    hand.pot = sb_actual + bb_actual
    
    # Build preflop action order: start from UTG (after BB)
    action_order = build_action_order(room, after_seat=bb_seat)
    hand.action_order = action_order
    hand.action_index = 0
    
    if action_order:
        hand.current_player_id = action_order[0]
    
    return room


def build_action_order(room: Room, after_seat: int) -> list[str]:
    """Build action order starting from player after given seat."""
    seated = get_seated_players(room)
    seat_indices = [p.seat for p in seated]
    
    # Reorder starting from after_seat
    start_idx = 0
    for i, s in enumerate(seat_indices):
        if s > after_seat:
            start_idx = i
            break
    else:
        start_idx = 0
    
    ordered = seat_indices[start_idx:] + seat_indices[:start_idx]
    
    result = []
    for s in ordered:
        pid = room.seats[s]
        if pid and pid in room.players:
            p = room.players[pid]
            if p.status == PlayerStatus.ACTIVE:
                result.append(pid)
    
    return result


def process_action(room: Room, player_id: str, action: PlayerAction, amount: int = 0) -> tuple[Room, dict]:
    """Process a player action. Returns updated room and event dict."""
    hand = room.hand
    if not hand or hand.current_player_id != player_id:
        return room, {"error": "Not your turn"}
    
    player = room.players[player_id]
    event = {"action": action.value, "player_id": player_id, "player_name": player.name}
    
    if action == PlayerAction.FOLD:
        player.status = PlayerStatus.FOLDED
        player.has_acted = True
        player.last_action = "fold"
        event["detail"] = "folded"
        
    elif action == PlayerAction.CHECK:
        if hand.current_bet > player.current_bet:
            return room, {"error": "Cannot check, must call or raise"}
        player.has_acted = True
        player.last_action = "check"
        event["detail"] = "checked"
        
    elif action == PlayerAction.CALL:
        call_amount = hand.current_bet - player.current_bet
        actual_call = min(call_amount, player.chips)
        player.chips -= actual_call
        player.current_bet += actual_call
        player.total_bet_this_hand += actual_call
        hand.pot += actual_call
        if player.chips == 0:
            player.status = PlayerStatus.ALL_IN
        player.has_acted = True
        player.last_action = f"call:{actual_call}"
        event["detail"] = f"called {actual_call}"
        event["amount"] = actual_call
        
    elif action == PlayerAction.RAISE:
        if amount <= hand.current_bet:
            return room, {"error": f"Raise must be more than current bet {hand.current_bet}"}
        raise_to = amount
        cost = raise_to - player.current_bet
        actual_cost = min(cost, player.chips)
        player.chips -= actual_cost
        actual_raise_to = player.current_bet + actual_cost
        player.current_bet = actual_raise_to
        player.total_bet_this_hand += actual_cost
        hand.pot += actual_cost
        hand.current_bet = actual_raise_to
        hand.last_raiser_id = player_id
        if player.chips == 0:
            player.status = PlayerStatus.ALL_IN
        player.has_acted = True
        player.last_action = f"raise:{actual_raise_to}"
        # Reset has_acted for others who need to respond to raise
        for pid in hand.action_order:
            if pid != player_id:
                p = room.players[pid]
                if p.status == PlayerStatus.ACTIVE:
                    p.has_acted = False
        player.has_acted = True
        event["detail"] = f"raised to {actual_raise_to}"
        event["amount"] = actual_raise_to
        
    elif action == PlayerAction.ALL_IN:
        all_in_amount = player.chips
        player.current_bet += all_in_amount
        player.total_bet_this_hand += all_in_amount
        hand.pot += all_in_amount
        player.chips = 0
        player.status = PlayerStatus.ALL_IN
        player.last_action = f"all_in:{player.current_bet}"
        if player.current_bet > hand.current_bet:
            hand.current_bet = player.current_bet
            hand.last_raiser_id = player_id
            for pid in hand.action_order:
                if pid != player_id:
                    p = room.players[pid]
                    if p.status == PlayerStatus.ACTIVE:
                        p.has_acted = False
        player.has_acted = True
        event["detail"] = f"all-in {player.current_bet}"
        event["amount"] = player.current_bet
    
    # Check if hand should end or street should advance
    room, phase_event = check_street_end(room)
    if phase_event:
        event["phase_change"] = phase_event
    
    return room, event


def check_street_end(room: Room) -> tuple[Room, Optional[dict]]:
    """Check if current street is over and advance accordingly."""
    hand = room.hand
    if not hand:
        return room, None
    
    active = get_active_players(room)
    
    # Only 1 player remaining -> hand ends
    if len(active) <= 1:
        return end_hand_single_winner(room)
    
    actionable = get_actionable_players(room)
    
    # Check if all actionable players have acted and matched the bet
    all_acted = True
    for p in actionable:
        if not p.has_acted:
            all_acted = False
            break
        if p.current_bet < hand.current_bet and p.status == PlayerStatus.ACTIVE:
            all_acted = False
            break
    
    if not all_acted:
        # Move to next player
        advance_to_next_player(room)
        return room, None
    
    # If 0 or 1 actionable players left, no more meaningful betting possible -> showdown
    if len(actionable) <= 1:
        return advance_to_showdown(room)
    
    # Street is complete, advance
    return advance_street(room)


def advance_to_next_player(room: Room):
    """Move current_player_id to next actionable player."""
    hand = room.hand
    if not hand:
        return
    
    actionable = get_actionable_players(room)
    if not actionable:
        return
    
    seated = get_seated_players(room)
    seat_to_pid = {p.seat: p.id for p in seated}
    seat_indices = sorted(seat_to_pid.keys())
    actionable_ids = {p.id for p in actionable}
    
    # Find current player's seat
    current_pid = hand.current_player_id
    if current_pid not in room.players:
        hand.current_player_id = actionable[0].id
        return
    
    current_seat = room.players[current_pid].seat
    
    # Find next actionable player by seat order
    ordered_seats = []
    found = False
    for s in seat_indices:
        if s > current_seat:
            found = True
        if found:
            ordered_seats.append(s)
    for s in seat_indices:
        if s <= current_seat:
            ordered_seats.append(s)
    
    for s in ordered_seats:
        pid = seat_to_pid.get(s)
        if pid and pid in actionable_ids and pid != current_pid:
            p = room.players[pid]
            if not p.has_acted or p.current_bet < hand.current_bet:
                hand.current_player_id = pid
                return
    
    # Fallback
    hand.current_player_id = actionable[0].id


def advance_street(room: Room) -> tuple[Room, Optional[dict]]:
    """Auto-advance to the next street."""
    hand = room.hand
    phase_order = [HandPhase.PREFLOP, HandPhase.FLOP, HandPhase.TURN, HandPhase.RIVER, HandPhase.SHOWDOWN]
    current_idx = phase_order.index(hand.phase)
    
    if current_idx >= len(phase_order) - 1:
        return advance_to_showdown(room)
    
    next_phase = phase_order[current_idx + 1]
    
    if next_phase == HandPhase.SHOWDOWN:
        return advance_to_showdown(room)
    
    hand.phase = next_phase
    hand.current_bet = 0
    hand.last_raiser_id = None
    
    # Reset player bets and last_action for new street
    for p in room.players.values():
        p.current_bet = 0
        if p.status == PlayerStatus.ACTIVE:
            p.has_acted = False
            p.last_action = None
    
    # Build action order from SB (or first active after dealer)
    action_order = build_action_order(room, after_seat=hand.dealer_seat)
    hand.action_order = action_order
    hand.action_index = 0
    
    if action_order:
        hand.current_player_id = action_order[0]
    else:
        return advance_to_showdown(room)
    
    return room, {"phase": next_phase.value, "auto_advance": True}


def advance_to_showdown(room: Room) -> tuple[Room, Optional[dict]]:
    """Move to showdown phase."""
    hand = room.hand
    hand.phase = HandPhase.SHOWDOWN
    hand.current_player_id = None
    
    # Calculate pots
    hand.pots = calculate_pots(room)
    
    return room, {"phase": "showdown", "pots": [p.model_dump() for p in hand.pots]}


def end_hand_single_winner(room: Room) -> tuple[Room, Optional[dict]]:
    """End hand when only one player remains."""
    hand = room.hand
    active = get_active_players(room)
    
    if len(active) == 1:
        winner = active[0]
        winner.chips += hand.pot
        event = {
            "phase": "hand_end",
            "winner": winner.id,
            "winner_name": winner.name,
            "pot": hand.pot,
            "single_winner": True,
        }
        reset_hand(room)
        return room, event
    
    # Fallback
    hand.pots = calculate_pots(room)
    return room, {"phase": "showdown"}


def calculate_pots(room: Room) -> list[PotInfo]:
    """Calculate main pot and side pots based on all-in amounts.
    
    Side pots are only created when players are all-in with different
    amounts. If nobody is all-in, there is just one main pot.
    """
    active = get_active_players(room)
    if not active:
        return []
    
    # Gather all players who contributed chips this hand
    contributors = [p for p in get_seated_players(room) if p.total_bet_this_hand > 0]
    
    if not contributors:
        return [PotInfo(id=str(uuid.uuid4())[:8], amount=room.hand.pot, eligible_players=[p.id for p in active])]
    
    # Only all-in players create side pot boundaries
    all_in_levels = sorted(set(
        p.total_bet_this_hand for p in contributors
        if p.status == PlayerStatus.ALL_IN
    ))
    
    # If no all-in players, just one main pot
    if not all_in_levels:
        return [PotInfo(
            id=str(uuid.uuid4())[:8],
            amount=room.hand.pot,
            eligible_players=[p.id for p in active],
        )]
    
    pots = []
    prev_level = 0
    
    for level in all_in_levels:
        pot_amount = 0
        eligible = []
        for p in contributors:
            contribution = min(p.total_bet_this_hand, level) - prev_level
            if contribution > 0:
                pot_amount += contribution
            # Eligible if not folded and bet at least this level
            if p.status != PlayerStatus.FOLDED and p.total_bet_this_hand >= level:
                eligible.append(p.id)
        
        if pot_amount > 0 and eligible:
            pots.append(PotInfo(
                id=str(uuid.uuid4())[:8],
                amount=pot_amount,
                eligible_players=eligible,
            ))
        prev_level = level
    
    # Remaining pot above the highest all-in level
    remaining = 0
    eligible = []
    for p in contributors:
        contribution = p.total_bet_this_hand - prev_level
        if contribution > 0:
            remaining += contribution
        if p.status != PlayerStatus.FOLDED and p.total_bet_this_hand > prev_level:
            eligible.append(p.id)
    
    if remaining > 0 and eligible:
        pots.append(PotInfo(
            id=str(uuid.uuid4())[:8],
            amount=remaining,
            eligible_players=eligible,
        ))
    
    # Fallback
    if not pots:
        pots.append(PotInfo(
            id=str(uuid.uuid4())[:8],
            amount=room.hand.pot,
            eligible_players=[p.id for p in active],
        ))
    
    return pots


def propose_settlement(room: Room, player_id: str, pot_winners: dict[str, list[str]]) -> tuple[Room, dict]:
    """A player proposes settlement. All showdown players must confirm."""
    hand = room.hand
    if not hand or hand.phase != HandPhase.SHOWDOWN:
        return room, {"error": "Not in showdown phase"}
    
    hand.settlement_proposal = SettlementProposal(
        proposer_id=player_id,
        pot_winners=pot_winners,
        confirmed_by=[player_id],  # proposer auto-confirms
    )
    return room, {"proposal": True, "proposer_id": player_id}


def confirm_settlement(room: Room, player_id: str) -> tuple[Room, dict]:
    """A player confirms the settlement proposal."""
    hand = room.hand
    if not hand or not hand.settlement_proposal:
        return room, {"error": "No settlement proposal"}
    
    if player_id not in hand.settlement_proposal.confirmed_by:
        hand.settlement_proposal.confirmed_by.append(player_id)
    
    # Check if all eligible players confirmed
    active = get_active_players(room)
    active_ids = {p.id for p in active}
    all_confirmed = all(pid in hand.settlement_proposal.confirmed_by for pid in active_ids)
    
    if all_confirmed:
        return execute_settlement(room)
    
    return room, {"confirmed": True, "player_id": player_id, "waiting": True}


def reject_settlement(room: Room, player_id: str) -> tuple[Room, dict]:
    """A player rejects the settlement proposal."""
    hand = room.hand
    if not hand or not hand.settlement_proposal:
        return room, {"error": "No settlement proposal"}
    
    hand.settlement_proposal = None
    return room, {"rejected": True, "player_id": player_id}


def execute_settlement(room: Room) -> tuple[Room, dict]:
    """Execute the confirmed settlement."""
    hand = room.hand
    proposal = hand.settlement_proposal
    pot_winners = proposal.pot_winners
    
    settlements = []
    
    for pot in hand.pots:
        winners = pot_winners.get(pot.id, [])
        valid_winners = [w for w in winners if w in pot.eligible_players] if winners else []
        
        # Fallback: if no valid winners specified, distribute to all eligible players
        if not valid_winners:
            valid_winners = pot.eligible_players
        
        if not valid_winners:
            continue
        
        min_chip = room.sb_amount  # minimum chip denomination
        n = len(valid_winners)
        # Round each share down to a multiple of min_chip
        share_raw = pot.amount // n
        share = (share_raw // min_chip) * min_chip
        # Remaining chips (in min_chip units) distributed one unit each to the first k winners
        leftover_units = (pot.amount - share * n) // min_chip
        
        for i, wid in enumerate(valid_winners):
            award = share + (min_chip if i < leftover_units else 0)
            room.players[wid].chips += award
            settlements.append({
                "pot_id": pot.id,
                "player_id": wid,
                "player_name": room.players[wid].name,
                "amount": award,
            })
    
    event = {"phase": "hand_end", "settlements": settlements, "single_winner": False}
    reset_hand(room)
    
    return room, event


def reset_hand(room: Room):
    """Reset hand state, prepare for next hand."""
    # Keep the dealer seat info for next hand
    old_dealer = room.hand.dealer_seat if room.hand else -1
    
    room.hand = HandState(dealer_seat=old_dealer)
    room.status = RoomStatus.WAITING
    
    # Reset player statuses
    for p in room.players.values():
        if p.seat >= 0:
            p.status = PlayerStatus.ACTIVE
            p.current_bet = 0
            p.total_bet_this_hand = 0
            p.has_acted = False
            p.ready = False


def can_cashout(room: Room, player_id: str) -> bool:
    """Check if player is eligible to cashout (chips exceed max_chips)."""
    if room.max_chips <= 0:
        return False
    player = room.players.get(player_id)
    if not player:
        return False
    if room.status == RoomStatus.PLAYING:
        return False
    return player.chips > room.max_chips


def do_cashout(room: Room, player_id: str) -> tuple[Room, dict]:
    """Process a cashout for a player."""
    if not can_cashout(room, player_id):
        return room, {"error": "Cannot cashout"}
    player = room.players[player_id]
    cashout_amount = room.initial_chips
    player.chips -= cashout_amount
    player.total_cashouts += cashout_amount
    return room, {
        "cashout": True,
        "player_id": player_id,
        "cashout_amount": cashout_amount,
        "remaining_chips": player.chips,
    }


def can_rebuy(room: Room, player_id: str) -> bool:
    """Check if player is eligible to rebuy."""
    player = room.players.get(player_id)
    if not player:
        return False
    if room.status == RoomStatus.PLAYING:
        return False
    return player.chips <= room.rebuy_minimum


def do_rebuy(room: Room, player_id: str) -> tuple[Room, dict]:
    """Process a rebuy for a player."""
    if not can_rebuy(room, player_id):
        return room, {"error": "Cannot rebuy"}
    player = room.players[player_id]
    player.chips = room.initial_chips
    player.total_rebuys += 1
    return room, {"rebuy": True, "player_id": player_id, "chips": player.chips}


def get_final_standings(room: Room) -> list[dict]:
    """Calculate final game standings with profit/loss including rebuys and cashouts."""
    standings = []
    for p in room.players.values():
        if p.seat < 0:
            continue
        total_investment = room.initial_chips * (1 + p.total_rebuys)
        total_value = p.chips + p.total_cashouts
        net = total_value - total_investment
        standings.append({
            "player_id": p.id,
            "player_name": p.name,
            "player_emoji": p.emoji,
            "chips": p.chips,
            "total_rebuys": p.total_rebuys,
            "total_cashouts": p.total_cashouts,
            "total_investment": total_investment,
            "net": net,
        })
    standings.sort(key=lambda x: x["net"], reverse=True)
    return standings


def end_game(room: Room) -> tuple[Room, dict]:
    """End the entire game session and calculate final standings."""
    standings = get_final_standings(room)
    room.status = RoomStatus.FINISHED
    return room, {"standings": standings}
