"use client"

import * as React from "react"
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Settings2,
  LayoutDashboard,
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
} from "@/components/ui/sidebar"


export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate()
  const location = useLocation()

  const navItems = [
    {
      title: "Dashboard",
      url: "/",
      icon: LayoutDashboard,
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings2,
    },
  ]

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
       <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-.5"
            >
              <a href="#">
                <MonitorCog className="!size-5" />
                <span className="text-base font-semibold">CISD TEMPS</span>

              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                onClick={() => navigate(item.url)}
                isActive={location.pathname === item.url}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm">
              <div className="flex flex-1 text-left text-sm leading-tight">
                <span className="truncate text-xs text-muted-foreground">
                  {new Date().getFullYear()} © Celina Independent School District
                </span>
              </div>
            </SidebarMenuButton>a
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}