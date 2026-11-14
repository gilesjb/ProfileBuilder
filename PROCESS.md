## Highlights

[Starting off]

❯ Read the assignment. Creat a requirements doc describing the functional 
  requirements of the Profile Builder application. Only list the functional
  requirements, not how it is implemented. 

⏺ I committed REQUIREMENTS.md as a494d71, "Add functional requirements for
  Profile Builder".

❯ ask me about the open decisions   

[Made some selections]  

⏺ Here's what I have so far:

  - Fields: Interests, Dietary & accessibility, and Logistics & companions.
  - Proactivity: a guided interview, where the assistant asks a question or two
    at a time.
  - Layout: the profile in a side panel on the right of the chat.

[I made a fairly arbitrary selection of what fields to include in the profile. My reasoning was that the design of the system would make it easy to change the set of fields later on if necessary.]

❯ ok let's talk architecture ... i want the backend to be a plain Node web application. it will serve the
  Profile page as simple HTML with no CSS or JS. all navigation within the
  application will be via `<a>` page links and data submission via `<form>`
  elements ... this service will only handle Profile definition and storage and destination  
  information. styling and chat functionality will exist only in the frontend.  
  make sense?

[I decided to go with a hypermedia-based architecture I've used before. It was a good fit for something I wanted to get working quickly because it's very simple and has minimal dependencies]

⏺ It mostly makes sense. Here's how I understand the split:

  - Backend (plain Node): owns the profile schema, storage, and
    getDestinationInfo. It serves unstyled HTML pages, uses `<a>` links for
    navigation and `<form>`s for writes, and has no JS and no LLM.
  - Frontend: owns the chat UI, the streaming, and all styling.

❯ The frontend will have an embedded chat sesssion that uses OpenRouter with a  
  user supplied api key   

⏺ Got it: the LLM runs in the browser and calls OpenRouter with a key the user
  enters. That answers where the model calls happen.

❯ The frontend in this version is just an HTML file loaded from the filesystem. 
  It makes JS fetches to the hard coded localhost web server endpoint and
  parses the HTML elements, treating them as its data model   

⏺ So there are two pieces:

  - Backend: a Node HTTP server on a hard-coded localhost port. It serves
    unstyled HTML with no JS, and that HTML is the API.
  - Frontend: one HTML file opened from disk (file://). It calls OpenRouter
    directly, calls the backend with fetch, and parses the backend's HTML into
    its data model.

  That's a hypermedia API with HTML as the data format. Setup would be about as
  fast as it gets: start the server and open the file.

❯ you are correct that the contract between backend and frontend is the HTML.   
  There are two consumers of this HTML on the frontend: React code which uses   
  the HTML as its data model, and the LLM which sees the HTML as the response   
  body of its tool calls. make sense?

⏺ Yes, that makes sense. A single fetch serves both consumers. When the LLM
  calls a tool, the frontend makes the request, passes the HTML body to the
  model as the tool result, and also parses that same HTML with DOMParser to
  update React state. The model and the UI can never disagree about the data,
  because they read the same response.

❯ The first thing to build is the Node backend. Once it's running you   
  can test it using curl, I can interact with it via a web browser. I will see  
  unstyled content in the browser but the form for submitting profile changes   
  should be functional.   

[Once this was running I opened http://localhost:3000/profile in my browser and made sure the basic profile-editing functionality was working]

❯ I want the frontend to be built in stages. Ask me about the stages

· In what order should the frontend be built? (Panel first (Recommended) / 
     Chat first / Thin vertical slice)

❯ Panel first is correct. I want a React front end that displays the read-only  
  contents of the /profile page. Use elegant contemporary styling.

⏺ Here's the plan for Stage 1:

  - A single file, frontend/index.html, using React and htm loaded from a CDN.
  - It fetches GET /profile, parses the HTML, and renders a read-only panel
    showing the profile values and any open conflicts.

[Once the index.html file was generated I opened it in a browser and verified that it was rendering the correct profile in the right hand panel. I then worked with Claude to get the chat pane working. At this point the chat agent did not have any tools allowing it to see or modify the profile]

❯ Now for tool set, I actually think we should start with very generic getPage and submitForm tools. make    
  sense?

⏺ Yes, it makes sense, and it follows from the design: if the HTML is the API,
  the model can use it the way a browser does. With two tools:

  - getPage(path) fetches a backend page and returns the status plus the <main>
    HTML.
  - submitForm(action, fields) posts form fields to a form's action and returns
    the response the same way.

[After Claude implemented Stage 3 the application was mostly functional. The rest of the session was relatively minor tweaks]

## Reflection

### Overall approach
My first goal was to get requirements and use cases established and flush out the ambiguities, and after that build something that was minimally complex and very easy to run. I had a pretty good idea of the application architecture I thought would enable this.

### What did I review by hand?
I skimmed the generated docs and did not read any of the code. If this was something I was shipping, I would be reading the docs more closely reading high level test code.

### What would I do differently next time.
I didn't add the `getDestinationInfo` tool as specified. My app doesn't need it because the agent can get destinations via `getPage` and `submitForm` tools rather than needing a specialized getDestinationInfo tool. It would be better to clarify requirements before making such a change, even if it's technically an implementation detail.

I didn't pay much attention to the profile schema. This impacted conflict handling: Initially the intention was to handle conflict detection in the backend but it became apparent that you can have semantic conflicts between different fields which I thought was easiest to handle by having the agent detect and flag them. I think in retrospect the better approach would have been to have a properly defined profile schema with inherent correctness semantics. However, it would also be fine to make this change later on, because with the architecture I used the backend and frontend are so loosely coupled that changing the backend data schema generally does not require any corresponding changes to the frontend.

### If this had to scale
My initial reaction to the question of what I would change if this was serving 10k requests per hour is that this design doesn't have any technical limitations on scaling to higher traffic rates.

The main issue with scaling is probably just cost of LLM tokens. So there would be motivation to pick a cheap model, but doing this while preserving functionality would place more emphasis on tuning the instructions the agent is given and the interface that it interacts with. This would involve defining success metrics, eg. how many agent interactions were required to complete the profile, and then using evals to measure how different configurations affected the metrics. If TPS is high enough, it would be viable to run different configurations in production and perform A/B testing .

