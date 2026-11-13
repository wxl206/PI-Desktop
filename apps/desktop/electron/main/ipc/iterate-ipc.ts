import { IPC } from "@pi-desktop/shared";
import type { BrowserWindow } from "electron";
import type { AccountClient } from "../iterate-account/client";
import type { AccountService } from "../iterate-account/service";
import type { AccountWindows } from "../iterate-account/windows";
import type { IpcRegistrar } from "./types";

export function registerIterateIpc(input: {
  registrar: Pick<IpcRegistrar, "handleWithEvent">;
  service: AccountService;
  windows: AccountWindows;
  getMainWindow: () => BrowserWindow | null;
  writeClipboard: (text: string) => void;
  client: AccountClient;
}) {
  const { registrar, service, windows, getMainWindow, writeClipboard } = input;
  const main = (channel: string, fn: (...args: any[]) => Promise<any>) => {
    registrar.handleWithEvent(channel, async (event, ...args) => {
      if (event.sender.id !== getMainWindow()?.webContents.id) throw new Error("renderer is not the main window");
      return fn(...args);
    });
  };
  main(IPC.invoke.iterateOverview, () => service.overview());
  main(IPC.invoke.iterateLogin, () => service.run(() => windows.login(input.client, () => service.signedIn())));
  main(IPC.invoke.iterateLogout, () => service.run(() => service.logout(() => windows.clear())));
  main(IPC.invoke.iterateDiscover, (group) => service.run(() => service.discover(group)));
  main(IPC.invoke.iterateConnect, (group, modelId) => service.run(() => service.connect(group, modelId)));
  main(IPC.invoke.iterateCopyKey, (group) => service.run(() => service.copyKey(group, writeClipboard)));
  main(IPC.invoke.iteratePurchase, () => windows.purchase());
  main(IPC.invoke.iterateConsole, () => windows.openConsole());
  main(IPC.invoke.iterateRedeem, (code) => service.run(() => service.redeem(code)));
  main(IPC.invoke.iterateAcknowledgeRedemption, () => service.run(() => service.acknowledgeRedemption()));
}
