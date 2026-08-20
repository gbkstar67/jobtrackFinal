import { useState } from "react";
import type { Employee } from "@shared/schema";

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

/**
 * An employee's picture, falling back to their coloured initials.
 *
 * The image is only requested when the employee actually has one — the list
 * endpoint reports hasAvatar so we don't fire a 404 for everyone else. If the
 * request fails anyway (deleted between render and load), it falls back rather
 * than showing a broken image.
 */
export default function Avatar({
  employee,
  className = "w-8 h-8",
  textClassName = "text-[11px]",
}: {
  employee: Pick<Employee, "id" | "name" | "color" | "hasAvatar">;
  className?: string;
  textClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = employee.hasAvatar && !failed;

  if (showImage) {
    return (
      <img
        src={`/api/employees/${employee.id}/avatar`}
        alt={employee.name}
        title={employee.name}
        onError={() => setFailed(true)}
        className={`${className} rounded-full object-cover border border-border bg-secondary flex-shrink-0`}
      />
    );
  }

  return (
    <span
      title={employee.name}
      className={`${className} ${textClassName} rounded-full font-bold flex items-center justify-center text-white flex-shrink-0 ${employee.color}`}
    >
      {getInitials(employee.name)}
    </span>
  );
}

export { getInitials };
