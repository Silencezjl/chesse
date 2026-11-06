"""Server-authoritative rules for the in-person bluffing game."""
from copy import deepcopy
import random
import secrets
import time

from games.bluff.questions import QUESTIONS

PEEK_SECONDS = 9.0


class RuleError(ValueError):
    pass


def create(room, options):
    players = options.get('participants')
    rounds = options.get('circles', 1)
    if (not isinstance(players, list) or any(not isinstance(p, str) for p in players)
            or len(set(players)) != len(players) or not 3 <= len(players) <= 9):
        raise RuleError('请选择 3–9 位不同的在线玩家')
    if any(p not in room['members'] or not room['members'][p]['connected'] for p in players):
        raise RuleError('只能选择在线房间成员')
    if not isinstance(rounds, int) or isinstance(rounds, bool) or not 1 <= rounds <= 3:
        raise RuleError('圈数必须为 1–3')
    order = list(players)
    first = secrets.randbelow(len(order))
    order = order[first:] + order[:first]
    state = {'id': room['id'], 'owner_id': room['owner_id'], 'players': order,
             'members': deepcopy(room['members']), 'circles': rounds,
             'round_index': 0, 'phase': 'choose', 'scores': {p: 3 for p in order},
             'used': [], 'history': [], 'question_id': None, 'roles': {},
             'ready': [], 'challenge': None, 'guess': None, 'result': None,
             'deadline': None, 'remaining': PEEK_SECONDS, 'paused': False,
             'terminated': False}
    deal(state)
    return state


def deal(state):
    judge = state['players'][state['round_index'] % len(state['players'])]
    others = [p for p in state['players'] if p != judge]
    honest = secrets.choice(others)
    state.update(judge=judge, roles={p: ('judge' if p == judge else 'honest' if p == honest else 'bluffer')
                                    for p in state['players']}, phase='choose', question_id=None,
                 ready=[], challenge=None, guess=None, result=None,
                 deadline=None, remaining=PEEK_SECONDS)


def question(state):
    return next((q for q in QUESTIONS if q['id'] == state['question_id']), None)


def online(state):
    return all(state['members'][p]['connected'] for p in state['players'])


def advance_time(state, now=None):
    now = time.time() if now is None else now
    if state['phase'] == 'viewing' and not state['paused'] and state['deadline'] is not None:
        if now >= state['deadline']:
            state.update(phase='discussion', deadline=None, remaining=0)
            return True
    return False


def presence(state, members, now=None, *, restarting=False):
    now = time.time() if now is None else now
    # On a restart, the last persisted remaining time is the most recent checkpoint.
    if not restarting:
        advance_time(state, now)
    state['members'] = {
        player_id: deepcopy(members.get(player_id, {**member, 'connected': False}))
        for player_id, member in state['members'].items()
    }
    paused = not online(state)
    if state['phase'] == 'viewing':
        if paused and not state['paused']:
            if restarting:
                remaining = state['remaining']
            else:
                remaining = max(0.0, state['deadline'] - now)
            state.update(remaining=remaining, deadline=None)
        elif not paused and state['paused']:
            state['deadline'] = now + state['remaining']
    state['paused'] = paused


def remaining(state, now=None):
    now = time.time() if now is None else now
    if state['phase'] != 'viewing':
        return None
    return max(0.0, state['remaining'] if state['paused'] else state['deadline'] - now)


def act(state, player, kind, data=None, *, now=None, rng=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise RuleError('无效操作数据')
    now = time.time() if now is None else now
    rng = rng or random.SystemRandom()
    advance_time(state, now)
    if kind == 'terminate':
        if player != state['owner_id']:
            raise RuleError('只有房主可以终止游戏')
        if state['phase'] == 'finished':
            raise RuleError('游戏已经结束')
        state.update(phase='finished', terminated=True, deadline=None)
        return
    if player not in state['players'] and not (kind == 'next' and player == state['owner_id']):
        raise RuleError('观众不能执行游戏操作')
    if state['paused']:
        raise RuleError('有参与玩家离线，请等待重连')
    if state['phase'] == 'finished':
        raise RuleError('游戏已经结束')
    is_judge = player == state['judge']
    if kind == 'draw':
        if not is_judge or state['phase'] != 'choose':
            raise RuleError('请等待想想选择题目')
        difficulty = data.get('difficulty')
        if not isinstance(difficulty, int) or isinstance(difficulty, bool) or difficulty not in (1, 2, 3):
            raise RuleError('请选择 1–3 分难度')
        pool = [q for q in QUESTIONS if q['difficulty'] == difficulty and q['id'] not in state['used']]
        if not pool:
            raise RuleError('该难度题库已用完，请选择其他难度')
        q = rng.choice(pool)
        state['used'].append(q['id'])
        state.update(question_id=q['id'], phase='prepare', ready=[])
    elif kind == 'skip':
        if not is_judge or state['phase'] != 'prepare':
            raise RuleError('只能由想想在查看答案之前换题')
        state.update(question_id=None, phase='choose', ready=[])
    elif kind == 'ready':
        if state['phase'] != 'prepare':
            raise RuleError('当前不能确认准备')
        if player in state['ready']:
            raise RuleError('你已准备')
        state['ready'].append(player)
        if len(state['ready']) == len(state['players']):
            # Keep a conservative checkpoint for an unclean server restart.
            state.update(phase='viewing', remaining=PEEK_SECONDS - .25, deadline=now + PEEK_SECONDS)
    elif kind == 'challenge':
        if not is_judge or state['phase'] != 'discussion' or state['challenge'] is not None:
            raise RuleError('只有想想可以质疑一次')
        target = data.get('target_id')
        if target not in state['players'] or target == player:
            raise RuleError('请选择其他参与玩家')
        state['challenge'] = target
    elif kind == 'guess':
        if not is_judge or state['phase'] != 'discussion' or state['challenge'] is None:
            raise RuleError('请先完成质疑，再指认老实人')
        target = data.get('target_id')
        if target not in state['players'] or target == player:
            raise RuleError('请选择其他参与玩家')
        state['guess'] = target
        q = question(state)
        delta = {p: 0 for p in state['players']}
        honest = next(p for p, role in state['roles'].items() if role == 'honest')
        if target == honest:
            delta[player] += q['difficulty']; delta[honest] += q['difficulty']
        else:
            delta[target] += q['difficulty']
        if state['roles'][state['challenge']] == 'bluffer':
            delta[player] += 1; delta[state['challenge']] -= 1
        else:
            delta[player] -= 3
        for p, d in delta.items():
            state['scores'][p] += d
        result = {'round': state['round_index'] + 1, 'judge': player, 'honest': honest,
                  'roles': dict(state['roles']), 'challenge': state['challenge'], 'guess': target,
                  'question': deepcopy(q), 'delta': delta, 'scores': dict(state['scores'])}
        state['history'].append(result)
        state.update(phase='reveal', result=result)
    elif kind == 'next':
        if state['phase'] != 'reveal' or player not in (state['judge'], state['owner_id']):
            raise RuleError('等待想想或房主进入下一轮')
        state['round_index'] += 1
        if state['round_index'] >= len(state['players']) * state['circles']:
            state.update(phase='finished', deadline=None)
        else:
            deal(state)
    else:
        raise RuleError('未知操作')


def view(state, player, now=None):
    """Only return data visible to this recipient; spectators receive no private role."""
    q = question(state)
    info = {'phase': state['phase'], 'room_id': state['id'], 'session_id': state.get('generation'), 'players': state['players'],
            'members': state['members'], 'owner_id': state['owner_id'], 'judge': state['judge'],
            'round': min(state['round_index'] + 1, len(state['players']) * state['circles']),
            'total_rounds': len(state['players']) * state['circles'], 'scores': state['scores'],
            'ready_count': len(state['ready']), 'paused': state['paused'],
            'remaining': remaining(state, now), 'terminated': state['terminated'],
            'available': {d: sum(q['difficulty'] == d and q['id'] not in state['used'] for q in QUESTIONS)
                          for d in (1, 2, 3)},
            'challenge_made': state['challenge'] is not None}
    if player in state['players']:
        info.update(my_role=state['roles'][player], i_ready=player in state['ready'])
        if player == state['judge'] and state['challenge']:
            info['my_challenge'] = state['challenge']
    if q:
        info['question'] = {k: q[k] for k in ('title', 'difficulty', 'hints')}
        if state['phase'] == 'viewing' and not state['paused'] and state['roles'].get(player) == 'honest' and (remaining(state, now) or 0) > 0:
            info['answer'] = q['answer']
    if state['phase'] in ('reveal', 'finished'):
        info['history'] = state['history']
        if state['result']:
            info['result'] = state['result']
    if state['phase'] == 'finished':
        high = max(state['scores'].values())
        info['winners'] = [p for p in state['players'] if state['scores'][p] == high]
    return info
