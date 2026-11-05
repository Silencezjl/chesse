// Shared nickname formatting for the lobby and all game frontends.
(() => {
  const pool = Object.freeze([
  "摸鱼小熊", "奶茶海獭", "脆皮企鹅", "发呆树懒", "飞奔小鸭", "偷吃仓鼠", "路过熊猫", "快乐水豚", "困困考拉", "暴走兔子",
  "芝士狐狸", "饭团小狗", "布丁小猫", "糯米团子", "芋泥啵啵", "草莓泡芙", "蜜桃乌龙", "西瓜汽水", "可乐加冰", "冰糖雪梨",
  "咸鱼翻身", "土豆队长", "番茄大王", "黄瓜骑士", "南瓜法师", "玉米超人", "香菜侦探", "蒜头军师", "豆芽选手", "洋葱学霸",
  "饼干警长", "面包侠", "客串高手", "运气选手", "随缘玩家", "快乐躺平", "椅子冠军", "沙发土豆", "饭点战神", "夜宵达人",
  "橘子汽船", "柠檬飞艇", "葡萄星球", "香蕉月亮", "菠萝宇航员", "荔枝骑手", "杨梅船长", "蓝莓水手", "椰子机长", "芒果探险家",
  "迷路蘑菇", "散步云朵", "打盹月亮", "星星打嗝", "彩虹溜号", "太阳赖床", "流星摸鱼", "银河干饭", "微风串门", "雨点蹦迪",
  "戏精小鹿", "社恐刺猬", "话痨鹦鹉", "佛系海豹", "傲娇松鼠", "佛脚袋鼠", "机智浣熊", "呆萌河马", "慢热乌龟", "冲浪鲸鱼",
  "一把就睡", "再玩一局", "先吃口饭", "等我想想", "我有妙计", "全凭直觉", "今天手气", "牌桌锦鲤", "懵圈选手", "气氛担当",
  "锅巴同学", "蛋挞老师", "麻薯学长", "酸奶学姐", "米糕同桌", "汤圆班长", "烧麦主任", "煎饺助教", "春卷校长", "馄饨教授",
  "沙雕海鸥", "拖鞋大侠", "被窝富翁", "奶盖侦探", "薯条刺客", "薯片勇士", "螺蛳粉侠", "烤串诗人", "火锅精灵", "珍珠奶龙",
]);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Only migrate the previous generated names; custom names stay intact.
  const legacy = new RegExp(`(${pool.join('|')})(\\d{2})(?!\\d)`, 'g');
  const text = value => String(value ?? '').replace(legacy, '$1#$2');
  const parts = value => {
    const name = text(value), match = /^(.*)(#\d{2})$/.exec(name);
    return match ? {base:match[1],tag:match[2]} : {base:name,tag:''};
  };
  const html = value => escape(text(value)).replace(/#\d{2}(?!\d)/g, tag => `<span class="name-tag">${tag}</span>`);
  const random = previous => {
    let value = pool[Math.floor(Math.random()*pool.length)] + '#' + String(Math.floor(Math.random()*100)).padStart(2,'0');
    if(value===previous)value=value.slice(0,-2)+String((Number(value.slice(-2))+1)%100).padStart(2,'0');
    return value;
  };
  globalThis.PlayerNames = Object.freeze({text,parts,html,random});
})();
