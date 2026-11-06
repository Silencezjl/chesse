"""Public game descriptions and validated waiting-room settings."""
from copy import deepcopy
from .rules import RULES

CATALOG = {
    'cheese': dict(title='奶酪大盗', icon='/assets/game-cheese-indigo-v1.webp', minimum=5, maximum=8,
                   description='一枚骰子，一个秘密。找出藏在朋友中的奶酪大盗。', tag='社交推理',
                   settings=[dict(key='outsider_dodobird', label='加入呆呆鸟', type='boolean', default=False),
                             dict(key='thief_see_all_dice', label='大盗可见所有点数', type='boolean', default=True),
                             dict(key='max_dice', label='骰子面数', type='number', default=6, min=6, max=10)]),
    'bluff': dict(title='瞎掰王', icon='/assets/game-bluff-indigo-v1.webp', minimum=3, maximum=9,
                  description='一本正经地胡说八道，看谁能找出唯一的老实人。', tag='即兴表演',
                  settings=[dict(key='circles', label='游戏圈数', type='number', default=1, min=1, max=3)]),
    'holdem': dict(title='Holdem 筹码', icon='/assets/game-holdem-indigo-v1.webp', minimum=2, maximum=12,
                   description='实体牌桌的随身筹码管家，和朋友轻松记账。', tag='线下牌桌',
                   settings=[dict(key='sb_amount', label='小盲注', type='number', default=10, min=1, max=1000000),
                             dict(key='initial_chips', label='初始筹码', type='number', default=1000, min=1, max=1000000000),
                             dict(key='rebuy_minimum', label='补码阈值', type='number', default=0, min=0, max=1000000000),
                             dict(key='hand_interval', label='每手间隔（秒）', type='number', default=5, min=0, max=300),
                             dict(key='max_chips', label='筹码上限（0 为不限）', type='number', default=0, min=0, max=1000000000)]),
}


def options_for(game_id, options):
    if game_id not in CATALOG:
        raise ValueError('未知游戏')
    fields = CATALOG[game_id]['settings']
    if set(options) - {f['key'] for f in fields}:
        raise ValueError('设置包含不支持的选项，请刷新页面')
    result = {}
    for field in fields:
        value = options.get(field['key'], field['default'])
        if field['type'] == 'boolean':
            valid = isinstance(value, bool)
        else:
            valid = type(value) is int and field['min'] <= value <= field['max']
        if not valid:
            raise ValueError(f"{field['label']}的值无效")
        result[field['key']] = value
    return result


def catalog():
    return [dict(id=gid, **deepcopy(info), rules=deepcopy(RULES[gid])) for gid, info in CATALOG.items()]
