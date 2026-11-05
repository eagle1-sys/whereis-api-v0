/**
 * @file sfex-mapping-test.ts
 * @description Unit tests for the SF Express supplement-event rules that fill in
 * missing 3300 (Arrived At Destination) and 3400 (Customs Clearance: Import
 * Released) events. The fixtures are trimmed real SF Express routes.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assert, assertEquals } from "@std/assert";
import { Sfex } from "../src/connectors/operator/sfex.ts";
import { Entity, Event } from "../src/main/model.ts";

function event(
  status: number,
  when: string,
  where: string,
  notes = "",
): Event {
  const value = new Event();
  value.status = status;
  value.when = when;
  value.where = where;
  value.notes = notes;
  return value;
}

function entityWith(...events: Event[]): Entity {
  const entity = new Entity();
  entity.events = events;
  return entity;
}

export function sfexMappingTest() {
  Deno.test("SFEx: no 3400 from an export-clearance event in the origin", () => {
    // Hong Kong transit clearance, then departure toward the Guangzhou customs
    // post: the shipment has not cleared import customs yet.
    const departure = event(
      3004,
      "2026-10-20T23:48:29+08:00",
      "香港",
      "快件离开 【香港青衣轉運中心】，已在发往  【广州机场关务组】 的路上",
    );
    const entity = entityWith(
      event(3350, "2026-10-19T18:07:55+08:00", "香港", "清关进行中,请耐心等候"),
      departure,
    );

    assertEquals(Sfex.isMissing3400(entity), false);
    assertEquals(Sfex.get3400BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: 3400 is inferred after leaving the import customs post", () => {
    const departure = event(
      3004,
      "2026-10-21T15:23:21+08:00",
      "广州市",
      "快件离开 【广州机场关务组】，已在发往 下一站 的路上",
    );
    const entity = entityWith(
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      departure,
    );

    assertEquals(Sfex.isMissing3400(entity), true);
    assertEquals(Sfex.get3400BaseEvent(entity), departure);
  });

  Deno.test("SFEx: an existing 3400 suppresses the supplement", () => {
    const entity = entityWith(
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-24T14:26:08+08:00", "广州市", "清关完成"),
      event(3004, "2026-10-24T16:28:54+08:00", "广州市", "快件离开 【广州机场关务组】"),
    );

    assertEquals(Sfex.isMissing3400(entity), false);
  });

  Deno.test("SFEx: a real 3400 after an origin departure wins over the supplement", () => {
    // The HK departure does not mention customs, so without anchoring on the
    // last 3350 this would fabricate a 3400 in Hong Kong before Guangzhou.
    const entity = entityWith(
      event(3350, "2026-10-19T18:07:55+08:00", "香港", "清关进行中,请耐心等候"),
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "快件离开 【香港青衣轉運中心】，已在发往 【深圳】 的路上"),
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-24T14:26:08+08:00", "广州市", "清关完成"),
    );

    assertEquals(Sfex.isMissing3400(entity), false);
    assertEquals(Sfex.get3400BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: 3300 lands at the arrival scan in the destination country", () => {
    const arrivalAtPost = event(
      3002,
      "2026-10-21T14:59:19+08:00",
      "广州市",
      "快件到达 【广州机场关务组】",
    );
    const entity = entityWith(
      event(3250, "2026-10-20T20:00:00+08:00", "三藩市", "航班已起飞"),
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      arrivalAtPost,
      event(3400, "2026-10-23T14:11:50+08:00", "广州市", "清关完成"),
      event(3002, "2026-10-25T02:49:11+08:00", "成都市", "快件到达 【成都长兴转运中心】"),
      event(3002, "2026-10-25T06:40:34+08:00", "成都市", "快件到达 【成都武侯长益路店】"),
      event(3450, "2026-10-25T07:57:41+08:00", "成都市", "快件交给快递员，正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    // The destination city arrival is NOT the base: the country arrival scan is.
    assertEquals(Sfex.get3300BaseEvent(entity), arrivalAtPost);
  });

  Deno.test("SFEx: the country arrival follows the actual port of entry", () => {
    // Not every shipment enters through Guangzhou: this one lands in Shanghai
    // and is delivered in Hangzhou.
    const arrivalAtPort = event(
      3002,
      "2026-10-21T09:12:44+08:00",
      "上海市",
      "快件到达 【上海浦东机场关务组】",
    );
    const entity = entityWith(
      event(3100, "2026-10-18T02:11:00+08:00", "纽约", "已收取快件"),
      event(3002, "2026-10-20T22:05:00+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      event(3350, "2026-10-21T07:40:00+08:00", "上海市", "清关进行中,请耐心等候"),
      arrivalAtPort,
      event(3400, "2026-10-22T10:15:00+08:00", "上海市", "清关完成"),
      event(3002, "2026-10-24T08:00:00+08:00", "杭州市", "快件到达 【杭州转运中心】"),
      event(3450, "2026-10-24T10:00:00+08:00", "杭州市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), arrivalAtPort);
    assertEquals(Sfex.get3300BaseEvent(entity)?.where, "上海市");
  });

  Deno.test("SFEx: the country arrival is the landing port, not the customs city", () => {
    // Lands in Shanghai, is cleared in Beijing: the entry is still Shanghai.
    const arrivalAtPort = event(
      3002,
      "2026-10-21T09:12:44+08:00",
      "上海市",
      "快件到达 【上海浦东机场关务组】",
    );
    const entity = entityWith(
      event(3100, "2026-10-18T02:11:00+08:00", "纽约", "已收取快件"),
      event(3002, "2026-10-20T22:05:00+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      arrivalAtPort,
      event(3350, "2026-10-22T08:30:00+08:00", "北京市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-23T11:00:00+08:00", "北京市", "清关完成"),
      event(3002, "2026-10-24T08:00:00+08:00", "北京市", "快件到达 【北京顺航转运中心】"),
      event(3450, "2026-10-24T10:00:00+08:00", "北京市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), arrivalAtPort);
    assertEquals(Sfex.get3300BaseEvent(entity)?.where, "上海市");
  });

  Deno.test("SFEx: 3300 is inferred after an in-transit event", () => {
    const departure = event(3004, "2026-10-22T05:12:09+08:00", "广州市", "快件离开 【广州穗北转运中心】");
    const entity = entityWith(
      event(3250, "2026-10-21T20:00:00+08:00", "广州市"),
      departure,
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), departure);
  });

  Deno.test("SFEx: an existing 3300 suppresses the supplement", () => {
    const entity = entityWith(
      event(3002, "2026-10-25T06:40:34+08:00", "成都市", "快件到达 【成都武侯长益路店】"),
      event(3300, "2026-10-25T06:40:34+08:00", "成都市", "Arrived At Destination"),
      event(3500, "2026-10-25T09:07:04+08:00", "成都市", "快件已签收"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
  });

  Deno.test("SFEx: a late arrival scan falls back to the customs event", () => {
    // SF logged the import release before the arrival scan at the post, so the
    // scan is late; anchoring on it would put the 3300 after the 3400.
    const customsStart = event(3350, "2026-10-27T07:55:08+08:00", "广州市", "清关进行中,请耐心等候");
    const lateScan = event(3002, "2026-10-28T09:00:00+08:00", "广州市", "快件到达 【广州机场关务组】");
    const delivered = event(3500, "2026-10-29T12:06:02+08:00", "成都市", "已派送成功");
    const beforeDelivery = entityWith(
      event(3250, "2026-10-26T20:00:00+08:00", "三藩市", "航班已起飞"),
      customsStart,
      event(3400, "2026-10-27T16:32:58+08:00", "广州市", "清关完成"),
      lateScan,
      event(3450, "2026-10-29T08:09:02+08:00", "成都市", "正在派送途中"),
    );

    // The fallback waits for delivery: a scan reported later cannot move it.
    assertEquals(Sfex.get3300BaseEvent(beforeDelivery), undefined);

    const deliveredEntity = entityWith(...beforeDelivery.events, delivered);
    assertEquals(Sfex.isMissing3300(deliveredEntity), true);
    assertEquals(Sfex.get3300BaseEvent(deliveredEntity), customsStart);
  });

  Deno.test("SFEx: no 3300 without an international leg", () => {
    // No flight and no transit event, so the country segment cannot be located;
    // the Beijing arrival must not stand in for it.
    const entity = entityWith(
      event(3350, "2026-10-27T07:55:08+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3002, "2026-10-29T13:53:54+08:00", "北京市", "快件到达 【北京朝阳合生国际店】"),
      event(3450, "2026-10-29T15:45:01+08:00", "北京市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: no 3300 without an arrival event", () => {
    const entity = entityWith(
      event(3100, "2026-10-17T02:32:23+08:00", "三藩市", "已收取快件"),
      event(3450, "2026-10-25T07:57:41+08:00", "成都市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: an origin arrival is not used as the destination arrival", () => {
    // The HK arrival is transit; only the import customs post counts, and here
    // the release was logged before the late arrival scan.
    const customsStart = event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候");
    const entity = entityWith(
      event(3002, "2026-10-18T10:00:00+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      customsStart,
      event(3400, "2026-10-24T14:26:08+08:00", "广州市", "清关完成"),
      event(3002, "2026-10-24T16:17:28+08:00", "广州市", "快件到达 【广州机场关务组】"),
      event(3003, "2026-10-25T04:00:27+08:00", "成都市", "快件在【成都转运中心】完成分拣"),
      event(3450, "2026-10-25T07:57:41+08:00", "成都市", "正在派送途中"),
      event(3500, "2026-10-25T09:07:04+08:00", "成都市", "快件已签收"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), customsStart);
    assert(Sfex.get3300BaseEvent(entity)?.where !== "香港");
  });

  Deno.test("SFEx: a transit arrival after the flight does not anchor the 3300", () => {
    // US -> HK -> Guangzhou customs -> Beijing. The legacy 3250 rule used to
    // place the 3300 at the HK hub, before the shipment had left the origin region.
    const arrivalAtPost = event(3002, "2026-10-27T15:09:08+08:00", "广州市", "快件到达 【广州机场关务组】");
    const entity = entityWith(
      event(3100, "2026-10-24T04:01:19+08:00", "三藩市", "已收取快件"),
      event(3250, "2026-10-24T20:00:00+08:00", "三藩市", "航班已起飞"),
      event(3002, "2026-10-26T03:54:36+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      event(3350, "2026-10-27T07:55:08+08:00", "广州市", "清关进行中,请耐心等候"),
      arrivalAtPost,
      event(3400, "2026-10-27T16:32:58+08:00", "广州市", "清关完成"),
      event(3002, "2026-10-29T13:53:54+08:00", "北京市", "快件到达 【北京朝阳合生国际店】"),
      event(3450, "2026-10-29T15:45:01+08:00", "北京市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), arrivalAtPost);
  });

  Deno.test("SFEx: domestic delivery without customs keeps its current behaviour", () => {
    const entity = entityWith(
      event(3100, "2026-10-17T02:32:23+08:00", "成都市", "已收取快件"),
      event(3002, "2026-10-18T09:00:00+08:00", "成都市", "快件到达 【成都武侯长益路店】"),
      event(3450, "2026-10-18T10:00:00+08:00", "成都市", "正在派送途中"),
      event(3500, "2026-10-18T12:00:00+08:00", "成都市", "快件已签收"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
  });

  Deno.test("SFEx: a 3350 after the real 3400 does not produce a duplicate", () => {
    // Repeated customs updates must not hide a clearance SF already reported.
    const entity = entityWith(
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-24T14:26:08+08:00", "广州市", "清关完成"),
      event(3350, "2026-10-24T15:00:00+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3004, "2026-10-24T16:28:54+08:00", "广州市", "快件离开 【广州机场关务组】"),
    );

    assertEquals(Sfex.isMissing3400(entity), false);
    assertEquals(Sfex.get3400BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: an origin 3400 does not suppress the import supplement", () => {
    const departure = event(
      3004,
      "2026-10-24T16:28:54+08:00",
      "广州市",
      "快件离开 【广州机场关务组】，已在发往 下一站 的路上",
    );
    const entity = entityWith(
      event(3350, "2026-10-19T18:07:55+08:00", "香港", "清关进行中,请耐心等候"),
      event(3400, "2026-10-20T08:00:00+08:00", "香港", "已清关"),
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "快件离开 【香港青衣轉運中心】，已在发往  【广州机场关务组】 的路上"),
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      departure,
    );

    assertEquals(Sfex.isMissing3400(entity), true);
    assertEquals(Sfex.get3400BaseEvent(entity), departure);
  });

  Deno.test("SFEx: isHeadingToCustoms separates departures into and out of customs", () => {
    assert(Sfex.isHeadingToCustoms(
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "已在发往  【广州机场关务组】 的路上"),
    ));
    assertEquals(
      Sfex.isHeadingToCustoms(
        event(3004, "2026-10-21T15:23:21+08:00", "广州市", "快件离开 【广州机场关务组】，已在发往 下一站 的路上"),
      ),
      false,
    );
    // An ASCII comma ends the clause: the 清关 keyword belongs to the next one.
    assertEquals(
      Sfex.isHeadingToCustoms(
        event(3004, "2026-10-21T15:23:21+08:00", "广州市", "快件已发往【广州】,等待清关后派送"),
      ),
      false,
    );
  });

  Deno.test("SFEx: an arrival after the customs departure is not the entry", () => {
    // No scan at the port: the Chengdu arrival two days later must not be used.
    const entity = entityWith(
      event(3250, "2026-10-20T20:00:00+08:00", "三藩市", "航班已起飞"),
      event(3002, "2026-10-20T18:32:39+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "已在发往  【广州机场关务组】 的路上"),
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3004, "2026-10-21T15:23:21+08:00", "广州市", "快件离开 【广州机场关务组】"),
      event(3002, "2026-10-22T09:00:00+08:00", "成都市", "快件到达 【成都长兴转运中心】"),
      event(3450, "2026-10-22T11:00:00+08:00", "成都市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: a direct flight without a leg marker gets no 3300", () => {
    // Neither a 3250 nor a transit event: the country arrival cannot be located,
    // so no 3300 is invented in Hangzhou.
    const entity = entityWith(
      event(3100, "2026-10-18T02:11:00+08:00", "洛杉矶", "已收取快件"),
      event(3004, "2026-10-18T20:00:00+08:00", "洛杉矶", "已起飞"),
      event(3350, "2026-10-21T07:40:00+08:00", "上海市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-22T10:15:00+08:00", "上海市", "清关完成"),
      event(3002, "2026-10-24T08:00:00+08:00", "杭州市", "快件到达 【杭州转运中心】"),
      event(3450, "2026-10-24T10:00:00+08:00", "杭州市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: a transit clearance alone is not the country entry", () => {
    // In progress: the only customs event so far is the Hong Kong transit one.
    const entity = entityWith(
      event(3250, "2026-10-19T20:00:00+08:00", "三藩市", "航班已起飞"),
      event(3002, "2026-10-20T18:32:39+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      event(3350, "2026-10-20T20:00:00+08:00", "香港", "清关进行中,请耐心等候"),
      event(3002, "2026-10-20T22:00:00+08:00", "香港", "快件到达 【香港青衣轉運中心】"),
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "已在发往  【广州机场关务组】 的路上"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: transfer customs keeps the landing port", () => {
    // Lands in Guangzhou, is transferred to Beijing customs afterwards.
    const arrivalAtPort = event(
      3002,
      "2026-10-21T09:00:00+08:00",
      "广州市",
      "快件到达 【广州机场关务组】",
    );
    const entity = entityWith(
      event(3100, "2026-10-18T02:11:00+08:00", "纽约", "已收取快件"),
      event(3002, "2026-10-20T22:05:00+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "已在发往  【广州机场关务组】 的路上"),
      arrivalAtPort,
      event(3350, "2026-10-21T10:00:00+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3250, "2026-10-21T12:00:00+08:00", "广州市", "国内航班已起飞"),
      event(3002, "2026-10-21T15:00:00+08:00", "北京市", "快件到达 【北京顺航转运中心】"),
      event(3350, "2026-10-21T16:00:00+08:00", "北京市", "转关清关进行中"),
      event(3400, "2026-10-21T18:00:00+08:00", "北京市", "清关完成"),
      event(3450, "2026-10-22T10:00:00+08:00", "北京市", "正在派送途中"),
    );

    assertEquals(Sfex.get3300BaseEvent(entity), arrivalAtPort);
    assertEquals(Sfex.get3300BaseEvent(entity)?.where, "广州市");
  });

  Deno.test("SFEx: incremental pulls do not invent a 3300", () => {
    // Pull 1: the shipment is still in Hong Kong, no customs event yet.
    const inTransit = entityWith(
      event(3100, "2026-10-18T02:11:00+08:00", "三藩市", "已收取快件"),
      event(3250, "2026-10-19T20:00:00+08:00", "三藩市", "航班已起飞"),
      event(3002, "2026-10-20T18:32:39+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
    );
    assertEquals(Sfex.isMissing3300(inTransit), false);
    assertEquals(Sfex.get3300BaseEvent(inTransit), undefined);

    // Pull 2: customs started, the arrival scan has not been reported yet.
    const atCustoms = entityWith(
      ...inTransit.events,
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
    );
    assertEquals(Sfex.isMissing3300(atCustoms), false);

    // Pull 3: the arrival scan shows up, and only now is the 3300 placed.
    const arrivalAtPort = event(3002, "2026-10-21T14:59:19+08:00", "广州市", "快件到达 【广州机场关务组】");
    const arrived = entityWith(...atCustoms.events, arrivalAtPort);
    assertEquals(Sfex.isMissing3300(arrived), true);
    assertEquals(Sfex.get3300BaseEvent(arrived), arrivalAtPort);
  });

  Deno.test("SFEx: the anchor never moves across pulls", () => {
    // Every prefix of a canonical inbound route must either produce no 3300 or
    // the same base as the finished route.
    const portScan = event(3002, "2026-10-21T14:59:19+08:00", "广州市", "快件到达 【广州机场关务组】");
    const route = [
      event(3100, "2026-10-18T02:11:00+08:00", "三藩市", "已收取快件"),
      event(3250, "2026-10-19T20:00:00+08:00", "三藩市", "航班已起飞"),
      event(3002, "2026-10-20T18:32:39+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "已在发往  【广州机场关务组】 的路上"),
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      portScan,
      event(3400, "2026-10-21T15:23:20+08:00", "广州市", "清关完成"),
      event(3450, "2026-10-23T09:33:36+08:00", "成都市", "正在派送途中"),
      event(3500, "2026-10-23T11:50:27+08:00", "成都市", "已派送成功"),
    ];

    for (let n = 1; n <= route.length; n++) {
      const base = Sfex.get3300BaseEvent(entityWith(...route.slice(0, n)));
      assert(
        base === undefined || base === portScan,
        `pull ${n} anchored on ${base?.status} ${base?.where}`,
      );
    }
  });

  Deno.test("SFEx: a transit 3400 does not suppress the country arrival", () => {
    const arrivalAtPort = event(3002, "2026-10-21T09:00:00+08:00", "广州市", "快件到达 【广州机场关务组】");
    const entity = entityWith(
      event(3350, "2026-10-19T18:07:55+08:00", "香港", "清关进行中,请耐心等候"),
      event(3400, "2026-10-20T08:00:00+08:00", "香港", "已清关"),
      event(3004, "2026-10-20T23:48:29+08:00", "香港", "已在发往  【广州机场关务组】 的路上"),
      arrivalAtPort,
      event(3350, "2026-10-21T10:00:00+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-21T15:00:00+08:00", "广州市", "清关完成"),
      event(3450, "2026-10-22T10:00:00+08:00", "成都市", "正在派送途中"),
    );

    assertEquals(Sfex.get3300BaseEvent(entity), arrivalAtPort);
  });

  Deno.test("SFEx: a Hong Kong destination gets no country entry", () => {
    const entity = entityWith(
      event(3350, "2026-10-20T10:00:00+08:00", "香港", "清关进行中,请耐心等候"),
      event(3400, "2026-10-20T14:00:00+08:00", "香港", "清关完成"),
      event(3002, "2026-10-20T18:00:00+08:00", "香港", "快件到达 【香港青衣轉運中心】"),
      event(3450, "2026-10-21T09:00:00+08:00", "香港", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: a mainland street named like a transit region is not transit", () => {
    // 青岛市香港中路 must not be mistaken for Hong Kong.
    const arrivalInQingdao = event(3002, "2026-10-21T09:00:00+08:00", "青岛市香港中路", "快件到达 【青岛机场】");
    const entity = entityWith(
      event(3250, "2026-10-20T20:00:00+08:00", "洛杉矶", "航班已起飞"),
      arrivalInQingdao,
      event(3350, "2026-10-21T10:00:00+08:00", "青岛市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-21T15:00:00+08:00", "青岛市", "清关完成"),
      event(3450, "2026-10-22T10:00:00+08:00", "青岛市", "正在派送途中"),
    );

    assertEquals(Sfex.get3300BaseEvent(entity), arrivalInQingdao);
  });

  Deno.test("SFEx: 待派送 is an arrival only without customs", () => {
    const waiting = { secondaryStatusCode: "1301", secondaryStatusName: "待派送", opCode: "70" };

    const crossBorder = entityWith(
      event(3350, "2026-10-27T07:55:08+08:00", "广州市", "清关进行中,请耐心等候"),
    );
    assertEquals(Sfex.getStatusCode(crossBorder, waiting), 3001);

    const domestic = entityWith(
      event(3100, "2026-10-17T02:32:23+08:00", "成都市", "已收取快件"),
    );
    assertEquals(Sfex.getStatusCode(domestic, waiting), 3300);
  });
}

// Registered at module load so `deno test tests/sfex-mapping-test.ts`
// discovers the tests; `tests/main-test.ts` imports this file for the same reason.
sfexMappingTest();
