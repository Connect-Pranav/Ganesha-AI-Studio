// shadcn/ui component (MIT, © 2023 shadcn), new-york-v4 style, with the "tw:" Tailwind prefix.
"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = "dark"

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster tw:group"
      icons={{
        success: <CircleCheckIcon className="tw:size-4" />,
        info: <InfoIcon className="tw:size-4" />,
        warning: <TriangleAlertIcon className="tw:size-4" />,
        error: <OctagonXIcon className="tw:size-4" />,
        loading: <Loader2Icon className="tw:size-4 tw:animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--sc-popover)",
          "--normal-text": "var(--sc-popover-foreground)",
          "--normal-border": "var(--sc-border)",
          "--border-radius": "var(--sc-radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
