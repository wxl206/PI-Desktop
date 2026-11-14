import { IPC } from "@pi-desktop/shared";
import type { AccountClient } from "../iterate-account/client";
import type { AccountService } from "../iterate-account/service";
import type { AccountWindows } from "../iterate-account/windows";
import type { IpcRegistrar } from "./types";

export function registerIterateIpc(input: {
  registrar: Pick<IpcRegistrar, "handleWithEvent" | "assertMainWindowSender">;
  service: AccountService;
  windows: AccountWindows;
  writeClipboard: (text: string) => void;
  client: AccountClient;
}) {
  const { registrar, service, windows, writeClipboard } = input;
  const main = (channel: string, fn: (...args: any[]) => Promise<any>) => {
    registrar.handleWithEvent(channel, async (event, ...args) => {
      registrar.assertMainWindowSender(event);
      return fn(...args);
    });
  };
  main(IPC.invoke.iterateOverview, () => service.run(() => service.overview()));
  main(IPC.invoke.iterateLogin, () => service.run(() => windows.login(input.client, () => service.signedIn())));
  main(IPC.invoke.iterateLogout, () => service.run(() => service.logout(() => windows.clear())));
  main(IPC.invoke.iterateDiscover, (group) => service.run(() => service.discover(group)));
  main(IPC.invoke.iterateConnect, (group, modelId) => service.run(() => service.connect(group, modelId)));
  main(IPC.invoke.iterateRebuildKey, (group) => service.run(() => service.rebuildKey(group)));
  main(IPC.invoke.iterateCopyKey, (group) => service.run(() => service.copyKey(group, writeClipboard)));
  main(IPC.invoke.iteratePurchase, () => windows.purchase());
  main(IPC.invoke.iterateConsole, () => windows.openConsole());
  main(IPC.invoke.iterateRedeem, (code) => service.run(() => service.redeem(code)));
  main(IPC.invoke.iterateAcknowledgeRedemption, () => service.run(() => service.acknowledgeRedemption()));
  main(IPC.invoke.iterateUsage, (force) => service.run(() => service.usageSummary(force === true)));
}
