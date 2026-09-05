#!/usr/bin/env python3
import ctypes
import sys
import time


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: x11-input.py <screen-x> <screen-y> <key|--wheel|--shortcut=key+key>")

    x = int(sys.argv[1])
    y = int(sys.argv[2])
    action = sys.argv[3]
    x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
    xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")
    x11.XOpenDisplay.restype = ctypes.c_void_p
    display = x11.XOpenDisplay(None)
    if not display:
        raise SystemExit("could not open the X11 display")

    try:
        x11.XFlush.argtypes = [ctypes.c_void_p]
        x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
        x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
        x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
        x11.XStringToKeysym.restype = ctypes.c_ulong
        x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        x11.XKeysymToKeycode.restype = ctypes.c_uint
        xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        if action.startswith("--drag-to="):
            target_x, target_y = map(int, action.removeprefix("--drag-to=").split(","))
            xtst.XTestFakeMotionEvent(display, -1, x, y, 0)
            x11.XSync(display, False)
            time.sleep(0.05)
            xtst.XTestFakeButtonEvent(display, 1, True, 0)
            x11.XSync(display, False)
            time.sleep(0.05)
            for step in range(1, 11):
                xtst.XTestFakeMotionEvent(display, -1, x + round((target_x - x) * step / 10), y + round((target_y - y) * step / 10), 0)
                x11.XSync(display, False)
                time.sleep(0.02)
            xtst.XTestFakeButtonEvent(display, 1, False, 0)
            x11.XSync(display, False)
            time.sleep(0.05)
            return
        if action == "--click":
            xtst.XTestFakeMotionEvent(display, -1, x, y, 0)
            x11.XSync(display, False)
            time.sleep(0.05)
            xtst.XTestFakeButtonEvent(display, 1, True, 0)
            xtst.XTestFakeButtonEvent(display, 1, False, 0)
            x11.XSync(display, False)
            time.sleep(0.05)
            return
        if action.startswith("--shortcut="):
            key_names = action.removeprefix("--shortcut=").split("+")
            keycodes = []
            for key_name in key_names:
                keysym = x11.XStringToKeysym(key_name.encode("ascii"))
                keycode = x11.XKeysymToKeycode(display, keysym)
                if not keycode:
                    raise SystemExit(f"could not resolve X11 key: {key_name}")
                keycodes.append(keycode)
            for keycode in keycodes:
                xtst.XTestFakeKeyEvent(display, keycode, True, 0)
            for keycode in reversed(keycodes):
                xtst.XTestFakeKeyEvent(display, keycode, False, 0)
            x11.XSync(display, False)
            time.sleep(0.05)
            return

        if action != "--wheel":
            keysym = x11.XStringToKeysym(action.encode("ascii"))
            keycode = x11.XKeysymToKeycode(display, keysym)
            if not keycode:
                raise SystemExit(f"could not resolve X11 key: {action}")

            xtst.XTestFakeKeyEvent(display, keycode, True, 0)
            xtst.XTestFakeKeyEvent(display, keycode, False, 0)
            x11.XFlush(display)
            time.sleep(0.05)

        xtst.XTestFakeMotionEvent(display, -1, x, y, 0)
        # XTest queues motion and button events asynchronously. In the
        # wheel-only path there is no preceding key/click delay, so a busy Xvfb
        # can otherwise deliver the wheel at the pointer's previous target.
        x11.XSync(display, False)
        time.sleep(0.05)
        if action != "--wheel":
            xtst.XTestFakeButtonEvent(display, 1, True, 0)
            xtst.XTestFakeButtonEvent(display, 1, False, 0)
            x11.XSync(display, False)
            time.sleep(0.05)

        for _ in range(3):
            xtst.XTestFakeButtonEvent(display, 5, True, 0)
            xtst.XTestFakeButtonEvent(display, 5, False, 0)
        # Do not close the X11 connection until the server has processed every
        # synthetic wheel event. This keeps physical-input assertions reliable
        # while the authoritative Docker suite runs six Electron shards.
        x11.XSync(display, False)
        time.sleep(0.05)
    finally:
        x11.XCloseDisplay(display)


if __name__ == "__main__":
    main()
