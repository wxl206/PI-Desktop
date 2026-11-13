import iterateLogoUrl from "../assets/brand/iterate-logo.png";

export function HomeMascotLogo() {
  return (
    <span
      className="home-mascot-logo"
      data-testid="home-mascot-logo"
      aria-hidden="true"
    >
      <img
        className="home-product-mark"
        src={iterateLogoUrl}
        alt=""
        width={100}
        height={100}
        draggable={false}
      />
    </span>
  );
}
