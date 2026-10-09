export interface ChapterMeta {
  id: string;
  no: string;
  name: string;
  en: string;
  time: string;
  clock: number; // minutes since 00:00 of the first day (22:40 = 1360)
  place: string;
  place2: string;
  /** rough real-time length (seconds) used to pace the in-game clock */
  expected: number;
}

const hm = (h: number, m: number) => (h < 12 ? h + 24 : h) * 60 + m;

export const CHAPTERS: ChapterMeta[] = [
  { id: 'prologue', no: '序章', name: '异常', en: 'Anomaly', time: '22:40', clock: hm(22, 40), place: '雾港市 · 海湾购物中心', place2: 'B1 · 保安监控室', expected: 150 },
  { id: 'ch1', no: '第一章', name: '雾中街', en: 'Streets in the Mist', time: '23:00', clock: hm(23, 0), place: '雾港老街区', place2: '潮音路', expected: 330 },
  { id: 'ch2', no: '第二章', name: '值夜', en: 'The Night Shift', time: '23:40', clock: hm(23, 40), place: '雾港市警察局', place2: '西港分局', expected: 420 },
  { id: 'ch3', no: '第三章', name: '白瓷', en: 'White Porcelain', time: '00:30', clock: hm(0, 30), place: '市立第二医院', place2: '地铁三号线 · 港湾站', expected: 420 },
  { id: 'ch4', no: '第四章', name: '忘川', en: 'Lethe', time: '01:20', clock: hm(1, 20), place: '城南排水系统', place2: '赫利生物 · 地下研究所', expected: 360 },
  { id: 'ch5', no: '第五章', name: '长夜', en: 'The Long Night', time: '02:00', clock: hm(2, 0), place: '研究所最深层', place2: '天台停机坪', expected: 300 },
];

export const PURGE_CLOCK = hm(5, 0);

export function chapterIndex(id: string) {
  return CHAPTERS.findIndex((c) => c.id === id);
}

export function fmtClock(min: number) {
  const m = Math.floor(min) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const LORE = [
  '「忘川」——赫利生物内部代号 LETHE。立项书第一页写着：让死去的细胞忘记自己已经死去。',
  '雾港市常年起雾。老人们说，雾是海替这座城市遮住的东西。',
  '22:15，港湾医院急诊收治第一例「咬伤后高热、意识丧失」患者。23:02，该患者从停尸间消失。',
  '军方通告：05:00 起对雾港市中心区执行「净化」。请市民立即向北撤离。',
  '提示：枪声会把附近的东西都引过来。能躲开的，就别打。',
  '提示：头部是大多数感染者的弱点。打腿可以让奔跑者摔倒。',
  '提示：背包空间有限。弹药、医疗品与电池——每一格都是选择。',
  '提示：按住 {crouch} 蹲下行走几乎不会发出声音。',
  '提示：壁行者畏光。手电筒照射会让它短暂退缩。',
  '提示：被抓住时连按 {interact} 挣脱。挣脱得越快，受的伤越少。',
  '提示：安全屋里的旧收音机可以手动存档。',
  '陈屿，前市局刑侦支队。三年前一次行动后主动离职。档案里只写着：「个人原因」。',
  '守夜人（NIGHTWATCH）。赫利生物资产编号 NW-03。任务优先级：清除全部知情者。',
  '如果你听见沉重的脚步声——不要回头确认。跑。',
];
