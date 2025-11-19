# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PathMap is a web application for creating and managing polygons from GPX track data. Multiple GPX files are combined to create convex hull polygons on a satellite map. The application allows users to organize tracks into polygons, move tracks between polygons, and persist sessions locally.

## Development Commands

### Running the Application
```bash
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build
```

### Dependencies
```bash
npm install          # Install all dependencies
```

## Architecture

### Core Modules

**main.js** - Application entry point and state management
- Manages global application state (polygons, tracks, sessions)
- Coordinates between UI, map, and storage modules
- Handles all user interactions and event delegation
- State includes: polygons array, next ID counter, map state

**map-manager.js** - Leaflet map integration
- Encapsulates all Leaflet map operations
- Manages polygon layers, track layers, and vertex labels
- Handles map state (center, zoom) for session persistence
- Uses Esri World Imagery for satellite tiles

**gpx-parser.js** - GPX file parsing
- Parses GPX XML to extract track points (lat/lon)
- Handles trkpt, wpt, and rtept elements
- Extracts track names from GPX metadata

**convex-hull.js** - Computational geometry
- Implements Graham's scan algorithm for convex hull computation
- Treats all GPX points as unordered when computing hull
- Merges multiple track point arrays into single convex hull

**storage.js** - Data persistence
- Saves/loads sessions to/from localStorage
- Exports sessions as JSON files
- Imports sessions from JSON files
- Uses key: 'pathmap_session'

### Data Model

**Polygon Object Structure:**
```javascript
{
  id: number,           // Unique identifier
  name: string,         // User-editable name
  color: string,        // Hex color (auto-assigned or user-selected)
  tracks: [             // Array of GPX tracks
    {
      id: number,       // Unique track identifier
      name: string,     // Track name from GPX or filename
      points: [         // Array of coordinates
        {lat: number, lon: number}
      ]
    }
  ],
  hull: [               // Computed convex hull vertices
    {lat: number, lon: number}
  ]
}
```

### Key Features

**Polygon Management:**
- Create multiple polygons with auto-assigned unique colors
- Each polygon contains multiple GPX tracks
- Convex hull automatically recomputed when tracks added/removed
- User can override polygon color and rename polygons

**Track Management:**
- Upload multiple GPX files to a polygon
- Move tracks between polygons (triggers hull recalculation)
- Delete individual tracks
- Toggle visibility of original GPX track lines on map

**Vertex Labels:**
- Each polygon vertex displays floating label with lat/lon coordinates
- Labels use Leaflet divIcon markers
- Always visible when polygon exists

**Session Persistence:**
- Auto-saves to localStorage on every state change
- Restores session on page load
- Download session as JSON file
- Upload session from JSON file
- Session includes all polygons, tracks, and map state

### Color Assignment

Colors are auto-assigned from COLOR_PALETTE array in main.js. The colorIndex cycles through 15 predefined colors to maximize visual distinction. Users can override with custom color picker.

### Map Integration

- Uses Leaflet.js for map rendering
- Satellite basemap from Esri World Imagery
- Polygons rendered with fill opacity 0.2, stroke weight 2
- Track lines rendered as dashed polylines when toggled on
- Map automatically fits bounds to show all polygons

### State Flow

1. User creates polygon → Added to state.polygons
2. User uploads GPX → Parsed → Added to polygon.tracks
3. Hull computation triggered → polygon.hull updated
4. Map updated with new/changed polygon
5. State saved to localStorage

When moving tracks between polygons, both source and destination polygons have hulls recomputed and map layers updated.
