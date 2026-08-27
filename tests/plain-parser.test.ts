import assert from "node:assert/strict";
import { parsePlainTextSenses } from "../src/dictionary/plain";

const traffic = `每天这个时候总是有很多来往车辆。
They were stuck in traffic and missed their flight.
他们遇到了塞车，没赶上班机。
a plan to reduce traffic congestion 减少交通拥塞的计划 traffic police (= who control traffic on a road or stop drivers who are breaking the law) 交通警察 The delay is due simply to the volume of traffic.
延误完全是因为交通拥挤。
2 the movement of ships, trains, aircraft, etc. along a particular route （沿固定路线的）航行，行驶，飞行 transatlantic traffic 横渡大西洋的航行 air traffic control 空中交通管制
3 the movement of people or goods from one place to another 运输；人流；货流 commuter/ freight/ passenger traffic 市郊间上下班运输；货╱客运 the traffic of goods between one country and another 一国与另一国间的货物运输
4 the movement of messages and signals through an electronic communication system 信息流量；通信（量） the computer servers that manage global Internet traffic 管理全球互联网通信的计算机服务器
5 ~ (in sth) illegal trade in sth （非法的）交易，买卖 the traffic in firearms 非法军火交易
traf∙fic /ˈtræfɪk/ verb (-ck-) 'traffic in sth to buy and sell sth illegally （非法）进行…交易，做…买卖 to traffic in drugs 买卖毒品`;

const senses = parsePlainTextSenses(traffic);
const lines = senses.flatMap((sense) => sense.lines);

assert.ok(
  senses.length >= 5,
  `expected at least 5 senses, got ${senses.length}`,
);
assert.ok(senses.some((sense) => sense.number === "2"));
assert.ok(senses.some((sense) => sense.number === "5"));
assert.ok(senses.some((sense) => sense.partOfSpeech === "v."));
assert.ok(lines.some((line) => line.kind === "example"));
assert.ok(lines.some((line) => line.kind === "translation"));
assert.ok(Math.max(...lines.map((line) => line.text.length)) <= 320);

console.log(
  JSON.stringify({
    senses: senses.length,
    lines: lines.length,
    maxLineLength: Math.max(...lines.map((line) => line.text.length)),
  }),
);
