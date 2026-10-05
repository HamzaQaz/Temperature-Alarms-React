import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { motion } from "framer-motion"

import { EASE_OUT_EXPO } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * The selected value of a controlled Tabs, so the active fill can be one element that slides
 * from the old tab to the new one (a shared layout move) instead of jumping. Uncontrolled
 * Tabs keep the stock per-tab fill.
 */
const TabsSelection = React.createContext<{ value: string; id: string } | null>(null)

function Tabs({
  className,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const id = React.useId()
  const selection = React.useMemo(() => (value === undefined ? null : { value, id }), [value, id])
  return (
    <TabsSelection.Provider value={selection}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={value}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </TabsSelection.Provider>
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-9 pointer-coarse:h-13 w-fit items-center justify-center rounded-lg p-[3px]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const selection = React.useContext(TabsSelection)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 pointer-coarse:px-3 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] duration-100 focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // A controlled Tabs draws its active fill once, as the sliding element below.
        selection && "relative isolate data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent",
        className
      )}
      {...props}
    >
      {selection?.value === value && (
        <motion.span
          aria-hidden
          layoutId={`${selection.id}-active`}
          transition={{ layout: { duration: 0.26, ease: EASE_OUT_EXPO } }}
          className="bg-background dark:border-input dark:bg-input/30 pointer-events-none absolute -inset-px -z-10 rounded-md shadow-sm dark:border"
        />
      )}
      {children}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
