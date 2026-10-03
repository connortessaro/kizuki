import { main } from "./main";

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(`kizuki: ${error.message}`);
  process.exit(1);
});
