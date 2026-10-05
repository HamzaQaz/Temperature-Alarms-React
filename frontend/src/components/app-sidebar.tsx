"use client"

import * as React from "react"
import { Link, useLocation } from 'react-router-dom'
import {
  Settings2,
  LayoutDashboard,
  Building2,
  Clock,
  MonitorCog
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"




export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {

  const location = useLocation()
  // On a phone the sidebar is a sheet over the page; picking a page should put it away.
  const { setOpenMobile } = useSidebar()

  const navItems = [
    {
      title: "Dashboard",
      url: "/",
      icon: LayoutDashboard,
      isActive: location.pathname === "/",
    },
    {
      title: "Campuses",
      url: "/campuses",
      icon: Building2,
      isActive: location.pathname === "/campuses",
    },
    {
      title: "Incidents",
      url: "/incidents",
      icon: Clock,
      isActive: location.pathname === "/incidents",
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings2,
      isActive: location.pathname === "/settings",
    },
  ]

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
       <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="#">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <MonitorCog className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Celina ISD</span>
                  <span className="truncate text-xs">Temperature Monitor</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Pages">
        <SidebarMenu>
      {navItems.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild isActive={item.isActive}>
            <Link to={item.url} onClick={() => setOpenMobile(false)}>
              <item.icon />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        {/* Plain text, not a button: there is nothing here to press. */}
        <p className="truncate px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          {new Date().getFullYear()} ©
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}