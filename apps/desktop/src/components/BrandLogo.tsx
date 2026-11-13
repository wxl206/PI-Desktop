// The cropped renderer asset keeps the horizontal Iterate mark legible at the
// 20px sidebar size instead of shrinking it inside a mostly transparent square.
import iterateLogoUrl from "../assets/brand/iterate-logo.png";

export function BrandLogo({ size = 16 }: { size?: number }) {
  return (
    <img
      className="brand-logo"
      src={iterateLogoUrl}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
    />
  );
}
