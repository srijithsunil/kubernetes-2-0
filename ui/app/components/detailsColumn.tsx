import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import type { DataTableColumnDef } from "@dynatrace/strato-components/tables";

/** A trailing "Details" action column that opens the drill-down sheet for a row. */
export function detailsColumn<T extends { id: string }>(
  onSelect: (row: T) => void
): DataTableColumnDef<T> {
  return {
    id: "details",
    header: "",
    accessor: () => "",
    cell: ({ rowData }: { rowData: T }) => (
      <Button onClick={() => onSelect(rowData)}>Details</Button>
    ),
  };
}
