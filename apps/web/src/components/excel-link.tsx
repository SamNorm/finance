import { FileSpreadsheet } from "lucide-react";
import { button } from "./styles";

// Downloads a workbook built from the figures as they stand. A plain link:
// the response is a file, not a page.
export function ExcelLink({
  href,
  title,
  label = "Excel",
}: {
  href: string;
  title: string;
  label?: string;
}) {
  return (
    <a href={href} download className={button.secondary} title={title}>
      <FileSpreadsheet />
      {label}
    </a>
  );
}
