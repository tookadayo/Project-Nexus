import {test as base,expect} from "@playwright/test";

/** Page-level fixture routes take precedence. Any request they do not handle
 * stays local to this synthetic browser test and never reaches a real API. */
export const test=base.extend<{syntheticNetworkOnly:void}>({
  syntheticNetworkOnly:[async({context},use)=>{
    await context.route("**/*",route=>route.fulfill({status:503,contentType:"text/plain",body:"UNMOCKED_SYNTHETIC_REQUEST"}));
    await use();
  },{auto:true}],
});
export {expect};
export type {Page} from "@playwright/test";
