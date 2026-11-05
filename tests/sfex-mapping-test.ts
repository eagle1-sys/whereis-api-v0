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

  Deno.test("SFEx: 3300 is inferred from the arrival before delivery", () => {
    const hub = event(3002, "2026-10-25T02:49:11+08:00", "成都市", "快件到达 【成都长兴转运中心】");
    const station = event(3002, "2026-10-25T06:40:34+08:00", "成都市", "快件到达 【成都武侯长益路店】");
    const entity = entityWith(
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-23T14:11:50+08:00", "广州市", "清关完成"),
      hub,
      station,
      event(3450, "2026-10-25T07:57:41+08:00", "成都市", "快件交给快递员，正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), station);
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

  Deno.test("SFEx: no 3300 without an arrival event", () => {
    const entity = entityWith(
      event(3100, "2026-10-17T02:32:23+08:00", "三藩市", "已收取快件"),
      event(3450, "2026-10-25T07:57:41+08:00", "成都市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
  });

  Deno.test("SFEx: an origin arrival is not used as the destination arrival", () => {
    // No 3002 after customs: better no 3300 than one in Hong Kong before import.
    const entity = entityWith(
      event(3002, "2026-10-18T10:00:00+08:00", "香港", "快件到达 【香港赤腊角航空轉運中心】"),
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-24T14:26:08+08:00", "广州市", "清关完成"),
      event(3003, "2026-10-25T04:00:27+08:00", "成都市", "快件在【成都转运中心】完成分拣"),
      event(3450, "2026-10-25T07:57:41+08:00", "成都市", "正在派送途中"),
    );

    assertEquals(Sfex.isMissing3300(entity), false);
    assertEquals(Sfex.get3300BaseEvent(entity), undefined);
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

  Deno.test("SFEx: a failed delivery attempt does not hide a later arrival", () => {
    const station = event(3002, "2026-10-25T06:40:34+08:00", "成都市", "快件到达 【成都武侯长益路店】");
    const entity = entityWith(
      event(3350, "2026-10-21T07:52:22+08:00", "广州市", "清关进行中,请耐心等候"),
      event(3400, "2026-10-23T14:11:50+08:00", "广州市", "清关完成"),
      event(3450, "2026-10-24T09:00:00+08:00", "成都市", "第一次派送未成功"),
      station,
      event(3500, "2026-10-25T09:07:04+08:00", "成都市", "快件已签收"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), station);
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

  Deno.test("SFEx: 3300 uses the arrival before a failed delivery attempt", () => {
    const stationA = event(3002, "2026-10-25T06:40:34+08:00", "成都市", "快件到达 【成都武侯长益路店】");
    const stationB = event(3002, "2026-10-25T12:00:00+08:00", "成都市", "快件回到 【成都武侯长益路店】");
    const entity = entityWith(
      event(3400, "2026-10-23T14:11:50+08:00", "广州市", "清关完成"),
      stationA,
      event(3450, "2026-10-25T07:57:41+08:00", "成都市", "第一次派送未成功"),
      stationB,
      event(3450, "2026-10-25T13:00:00+08:00", "成都市", "正在派送途中"),
      event(3500, "2026-10-25T15:00:00+08:00", "成都市", "快件已签收"),
    );

    assertEquals(Sfex.isMissing3300(entity), true);
    assertEquals(Sfex.get3300BaseEvent(entity), stationA);
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
}

// Registered at module load so `deno test tests/sfex-mapping-test.ts`
// discovers the tests; `tests/main-test.ts` imports this file for the same reason.
sfexMappingTest();
