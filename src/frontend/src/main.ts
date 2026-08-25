import "./style.css";

const status = document.querySelector<HTMLDivElement>("#status");

if (!status) {
  throw new Error("Shell status element is missing");
}
